import { Schema, Document } from 'mongoose';
import { isCachingEnabled } from '../utils/commonUtils';
import { publishRecordIdsOnChannel } from '../utils/redisUtils';
import { DocumentWithIdAndTenantValue, MongooseDocumentEvents, MongooseDocumentEventsContext, MongooseManyObjectOperationEventContext, SpeedGooseCacheAutoCleanerOptions, SpeedGooseRedisChannels } from '../types/types';
import { getMongooseModelFromDocument } from '../utils/mongooseUtils';
import { getRecordsAffectedByAction, getRecordAffectedByAction, wasRecordDeleted } from './utils';
import { clearParentCache, clearParentCacheBulk } from '../utils/cacheClientUtils';

const MONGOOSE_DELETE_ONE_ACTIONS = ['findByIdAndRemove', 'findByIdAndDelete', 'findOneAndDelete', 'findOneAndRemove', 'deleteOne'];
const MONGOOSE_UPDATE_ONE_ACTIONS = ['updateOne', 'findOneAndUpdate', 'findByIdAndUpdate'];
const MONGOOSE_UPDATE_MANY_ACTIONS = ['updateMany'];
const MONGOOSE_DELETE_MANY_ACTIONS = ['deleteMany'];

const appendQueryBasedListeners = (schema: Schema): void => {
    //@ts-expect-error this event work, but it's just not added into types
    schema.pre([...MONGOOSE_DELETE_ONE_ACTIONS, ...MONGOOSE_UPDATE_ONE_ACTIONS], async function () {
        if (!isCachingEnabled()) return;
        const action = this as any;
        const model = action.model;
        const updatedRecord = await getRecordAffectedByAction(action);
        if (updatedRecord) {
            const wasDeleted = MONGOOSE_DELETE_ONE_ACTIONS.includes(action.op);
            await publishRecordIdsOnChannel(SpeedGooseRedisChannels.RECORDS_CHANGED, String(updatedRecord._id));
            model.emit(MongooseDocumentEvents.SINGLE_DOCUMENT_CHANGED, <MongooseDocumentEventsContext>{ record: updatedRecord, wasNew: false, wasDeleted, modelName: model.modelName });
            try {
                await clearParentCache(model.modelName, updatedRecord._id as string);
            } catch (err) {
                console.error('Error clearing parent cache:', err);
            }
        }
    });

    //@ts-expect-error this event work, but it's just not added into types
    schema.pre([...MONGOOSE_UPDATE_MANY_ACTIONS, ...MONGOOSE_DELETE_MANY_ACTIONS], { query: true }, async function () {
        if (!isCachingEnabled()) return;
        const action = this as any;
        const model = action.model;
        const affectedRecords = await getRecordsAffectedByAction(action);
        if (affectedRecords.length > 0) {
            const wasDeleted = MONGOOSE_DELETE_MANY_ACTIONS.includes(action.op);
            await publishRecordIdsOnChannel(
                SpeedGooseRedisChannels.RECORDS_CHANGED,
                affectedRecords.map(record => record._id),
            );
            model.emit(MongooseDocumentEvents.MANY_DOCUMENTS_CHANGED, <MongooseManyObjectOperationEventContext>{ records: affectedRecords, wasDeleted, modelName: model.modelName });
            // Clear parent caches for all affected records with deduplication
            try {
                await clearParentCacheBulk(
                    model.modelName,
                    affectedRecords.map(record => String(record._id)),
                );
            } catch (err) {
                console.error('Error clearing parent cache:', err);
            }
        }
    });
};

const appendDocumentBasedListeners = (schema: Schema, options: SpeedGooseCacheAutoCleanerOptions): void => {
    schema.pre('save', async function () {
        if (!isCachingEnabled()) return;
        this.$locals.wasNew = this.isNew;
        this.$locals.wasDeleted = wasRecordDeleted(this, options);
        const model = getMongooseModelFromDocument(this as Document);
        if (model) {
            await publishRecordIdsOnChannel(SpeedGooseRedisChannels.RECORDS_CHANGED, String(this._id));
            model.emit(MongooseDocumentEvents.SINGLE_DOCUMENT_CHANGED, <MongooseDocumentEventsContext>{
                record: this,
                wasNew: this.$locals.wasNew,
                wasDeleted: this.$locals.wasDeleted,
                modelName: model.modelName,
            });
            try {
                await clearParentCache(model.modelName, this._id as string);
            } catch (err) {
                console.error('Error clearing parent cache:', err);
            }
        }
    });

    schema.post('insertMany', async function (insertedDocuments) {
        if (!isCachingEnabled()) return;
        if (insertedDocuments.length > 0) {
            //@ts-expect-error current type returned in the event is type Query - not document
            const records = insertedDocuments as DocumentWithIdAndTenantValue[];
            this.emit(MongooseDocumentEvents.MANY_DOCUMENTS_CHANGED, <MongooseManyObjectOperationEventContext>{ records, wasNew: true, wasDeleted: false, modelName: this.modelName });
        }
    });

    schema.post(/deleteOne/, async function (record: Document) {
        if (!isCachingEnabled()) return;
        const model = getMongooseModelFromDocument(record);
        if (model) {
            await publishRecordIdsOnChannel(SpeedGooseRedisChannels.RECORDS_CHANGED, String(record._id));
            model.emit(MongooseDocumentEvents.SINGLE_DOCUMENT_CHANGED, <MongooseDocumentEventsContext>{ record, wasDeleted: true, modelName: model.modelName });
            try {
                await clearParentCache(model.modelName, String(record._id));
            } catch (err) {
                console.error('Error clearing parent cache:', err);
            }
        }
    });
};

const speedGooseEventListeners = (schema: Schema, options: SpeedGooseCacheAutoCleanerOptions): void => {
    appendDocumentBasedListeners(schema, options);
    appendQueryBasedListeners(schema);
};

const isListenerPluginRegisteredForSchema = (schema: Schema): boolean => schema.plugins.some(plugin => plugin?.fn.name === speedGooseEventListeners.name);

export const SpeedGooseCacheAutoCleaner = (schema: Schema, options: SpeedGooseCacheAutoCleanerOptions): void => {
    /* Note: This is special logic to avoid duplicating listeners for given events */
    if (!isListenerPluginRegisteredForSchema(schema)) {
        schema.plugin(speedGooseEventListeners, options);
    }
};
