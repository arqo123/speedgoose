import {Mongoose, Schema, Document} from "mongoose";
import {clearCacheOnClientForKey, clearHydrationCache} from "../cacheClientUtils";
import {publishRecordIdOnChannel} from "../redisUtils";
import {CacheClients, MongooseDocumentEvents, MongooseDocumentEventsContext, SpeedGooseCacheAutoCleanerOptions, SpeedGooseRedisChannels} from "../types/types";
import {generateCacheKeyForRecordAndModelName, getMongooseModelFromDocument} from "../utils";

type MongooseDocumentEventCallback = (context: MongooseDocumentEventsContext, cacheClients: CacheClients) => void

export default (mongoose: Mongoose, cacheClients: CacheClients): void => {
    listenOnInternalEvents(mongoose, cacheClients, [MongooseDocumentEvents.BEFORE_SAVE, MongooseDocumentEvents.AFTER_REMOVE], clearCacheForRecordCallback)
}

const clearModelCache = async (context: MongooseDocumentEventsContext, cacheClients: CacheClients): Promise<void> => {
    const modelCacheKey = generateCacheKeyForRecordAndModelName(context.record, context.modelName)

    await clearCacheOnClientForKey(modelCacheKey, cacheClients.modelsKeyCache, cacheClients)
}

const clearCacheForRecordCallback = async (context: MongooseDocumentEventsContext, cacheClients: CacheClients): Promise<void> => {
    const recordId = String(context.record._id)
    await clearCacheOnClientForKey(recordId, cacheClients.recordsKeyCache, cacheClients)
    await clearHydrationCache(recordId, cacheClients)

    if (context.wasNew || context.wasDeleted) {
        await clearModelCache(context, cacheClients)
    }
}

const listenOnInternalEvents = (
    mongoose: Mongoose,
    cacheClients: CacheClients,
    eventsToListen: MongooseDocumentEvents[],
    callback: MongooseDocumentEventCallback): void => {
    eventsToListen.forEach(event => {
        Object.values(mongoose?.models ?? {}).forEach(model => {
            model.on(event, async (context: MongooseDocumentEventsContext) => {
                await callback(context, cacheClients)
            })
        })
    })
}

const wasRecordDeleted = <T>(record: Document<T>, options: SpeedGooseCacheAutoCleanerOptions): boolean => {
    if (record && options?.wasRecordDeletedCallback) {
        return options.wasRecordDeletedCallback(record)
    }

    return false
}

const appendPreSaveListener = (schema: Schema, options: SpeedGooseCacheAutoCleanerOptions): void => {
    schema.pre('save', {document: true}, async function (next) {
        this.$locals.wasNew = this.isNew
        this.$locals.wasDeleted = wasRecordDeleted(this, options)
        const model = getMongooseModelFromDocument(this)

        await publishRecordIdOnChannel(SpeedGooseRedisChannels.SAVED_DOCUMENTS, String(this._id))
        model.emit(MongooseDocumentEvents.BEFORE_SAVE, <MongooseDocumentEventsContext>{record: this, wasNew: this.isNew, wasDeleted: this.$locals.wasDeleted, modelName: model.modelName})
        next()
    })
}

const appendPostSaveListener = (schema: Schema): void => {
    schema.post('save', {document: true}, async function (record, next) {
        const wasNew = this.$locals.wasNew
        const wasDeleted = this.$locals.wasDeleted
        const model = getMongooseModelFromDocument(record)

        model.emit(MongooseDocumentEvents.AFTER_SAVE, <MongooseDocumentEventsContext>{record, wasNew, wasDeleted, modelName: model.modelName})
        next()
    })
}

const appendPostRemoveListener = (schema: Schema): void => {
    schema.post('remove', {document: true}, async function (record, next) {
        const model = getMongooseModelFromDocument(record)

        await publishRecordIdOnChannel(SpeedGooseRedisChannels.REMOVED_DOCUMENTS, String(record._id))
        model.emit(MongooseDocumentEvents.AFTER_REMOVE, <MongooseDocumentEventsContext>{record, wasDeleted: true, modelName: model.modelName})
        next()
    })
}

export const SpeedGooseCacheAutoCleaner = (schema: Schema, options: SpeedGooseCacheAutoCleanerOptions): void => {
    appendPreSaveListener(schema, options)
    appendPostSaveListener(schema)
    appendPostRemoveListener(schema)
}

