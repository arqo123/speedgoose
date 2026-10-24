import { Schema, Document, Model, Query } from 'mongoose';
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

// Records found by a pre hook are invalidated again once the write has committed: a read between the
// first clear and the commit would otherwise put the old state back into the cache for the full TTL.
const AFFECTED_RECORDS = Symbol('speedgooseAffectedRecords');

type QueryWithAffectedRecords = Query<unknown, unknown> & { [AFFECTED_RECORDS]?: DocumentWithIdAndTenantValue[] };

const invalidateRecord = async (model: Model<unknown>, record: DocumentWithIdAndTenantValue, wasNew: boolean, wasDeleted: boolean): Promise<void> => {
    await publishRecordIdsOnChannel(SpeedGooseRedisChannels.RECORDS_CHANGED, String(record._id));
    model.emit(MongooseDocumentEvents.SINGLE_DOCUMENT_CHANGED, <MongooseDocumentEventsContext>{ record, wasNew, wasDeleted, modelName: model.modelName });
    try {
        await clearParentCache(model.modelName, record._id as string);
    } catch (err) {
        console.error('Error clearing parent cache:', err);
    }
};

const invalidateRecords = async (model: Model<unknown>, records: DocumentWithIdAndTenantValue[], wasNew: boolean, wasDeleted: boolean): Promise<void> => {
    await publishRecordIdsOnChannel(
        SpeedGooseRedisChannels.RECORDS_CHANGED,
        records.map(record => String(record._id)),
    );
    model.emit(MongooseDocumentEvents.MANY_DOCUMENTS_CHANGED, <MongooseManyObjectOperationEventContext>{ records, wasNew, wasDeleted, modelName: model.modelName });
    // Clear parent caches for all affected records with deduplication
    try {
        await clearParentCacheBulk(
            model.modelName,
            records.map(record => String(record._id)),
        );
    } catch (err) {
        console.error('Error clearing parent cache:', err);
    }
};

/* After the write: the records found before it, or - for an upsert that matched nothing - the inserted ones. */
const getRecordsAfterWrite = async (action: QueryWithAffectedRecords, findRecords: () => Promise<DocumentWithIdAndTenantValue[]>): Promise<{ records: DocumentWithIdAndTenantValue[]; wasNew: boolean }> => {
    const records = action[AFFECTED_RECORDS] ?? [];
    if (records.length === 0 && action.getOptions().upsert) {
        return { records: await findRecords(), wasNew: true };
    }
    return { records, wasNew: false };
};

const appendQueryBasedListeners = (schema: Schema): void => {
    //@ts-expect-error this event work, but it's just not added into types
    schema.pre([...MONGOOSE_DELETE_ONE_ACTIONS, ...MONGOOSE_UPDATE_ONE_ACTIONS], async function () {
        if (!isCachingEnabled()) return;
        const action = this as unknown as QueryWithAffectedRecords;
        const updatedRecord = await getRecordAffectedByAction(action);
        action[AFFECTED_RECORDS] = updatedRecord ? [updatedRecord] : [];
        if (updatedRecord) {
            await invalidateRecord(action.model, updatedRecord, false, MONGOOSE_DELETE_ONE_ACTIONS.includes(action.op));
        }
    });

    //@ts-expect-error this event work, but it's just not added into types
    schema.post([...MONGOOSE_DELETE_ONE_ACTIONS, ...MONGOOSE_UPDATE_ONE_ACTIONS], async function () {
        if (!isCachingEnabled()) return;
        const action = this as unknown as QueryWithAffectedRecords;
        // The write has already committed - never fail it from here.
        try {
            const { records, wasNew } = await getRecordsAfterWrite(action, async () => {
                const upserted = await getRecordAffectedByAction(action);
                return upserted ? [upserted] : [];
            });
            for (const record of records) {
                await invalidateRecord(action.model, record, wasNew, MONGOOSE_DELETE_ONE_ACTIONS.includes(action.op));
            }
        } catch (err) {
            console.error('Error clearing cache after write:', err);
        }
    });

    //@ts-expect-error this event work, but it's just not added into types
    schema.pre([...MONGOOSE_UPDATE_MANY_ACTIONS, ...MONGOOSE_DELETE_MANY_ACTIONS], { query: true }, async function () {
        if (!isCachingEnabled()) return;
        const action = this as unknown as QueryWithAffectedRecords;
        const affectedRecords = await getRecordsAffectedByAction(action);
        action[AFFECTED_RECORDS] = affectedRecords;
        if (affectedRecords.length > 0) {
            await invalidateRecords(action.model, affectedRecords, false, MONGOOSE_DELETE_MANY_ACTIONS.includes(action.op));
        }
    });

    //@ts-expect-error this event work, but it's just not added into types
    schema.post([...MONGOOSE_UPDATE_MANY_ACTIONS, ...MONGOOSE_DELETE_MANY_ACTIONS], { query: true }, async function () {
        if (!isCachingEnabled()) return;
        const action = this as unknown as QueryWithAffectedRecords;
        // The write has already committed - never fail it from here.
        try {
            const { records, wasNew } = await getRecordsAfterWrite(action, () => getRecordsAffectedByAction(action));
            if (records.length > 0) {
                await invalidateRecords(action.model, records, wasNew, MONGOOSE_DELETE_MANY_ACTIONS.includes(action.op));
            }
        } catch (err) {
            console.error('Error clearing cache after write:', err);
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

    schema.post('save', async function () {
        if (!isCachingEnabled()) return;
        const model = getMongooseModelFromDocument(this as Document);
        if (!model) return;
        // The write has already committed - never fail it from here.
        try {
            await invalidateRecord(model, this as unknown as DocumentWithIdAndTenantValue, this.$locals.wasNew as boolean, this.$locals.wasDeleted as boolean);
        } catch (err) {
            console.error('Error clearing cache after write:', err);
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
