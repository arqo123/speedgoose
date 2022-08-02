import {Mongoose, Schema, Document} from "mongoose";
import {clearCacheOnClientForKey, clearHydrationCache} from "../cacheClientUtils";
import {CacheClients, MongooseCacheAutoCleanerOptions, MongooseDocumentEvents, MongooseDocumentEventsContext} from "../types/types";
import {getMongooseModelFromDocument} from "../utils";

type MongooseDocumentEventCallback = (context: MongooseDocumentEventsContext, cacheClients: CacheClients) => void

export default (mongoose: Mongoose, cacheClients: CacheClients): void => {
    listenOnEvents(mongoose, cacheClients, [MongooseDocumentEvents.AFTER_SAVE], clearCacheForRecordCallback)
}

const clearCacheForRecordCallback = async (context: MongooseDocumentEventsContext, cacheClients: CacheClients): Promise<void> => {
    const recordId = String(context.record._id)
    await clearCacheOnClientForKey(recordId, cacheClients.recordsKeyCache, cacheClients)
    await clearHydrationCache(recordId, cacheClients)

    if (context.wasNew || context.wasDeleted) {
        await clearCacheOnClientForKey(context.modelName, cacheClients.modelsKeyCache, cacheClients)
    }
}

const listenOnEvents = (
    mongoose: Mongoose,
    cacheClients: CacheClients,
    eventsToListen: MongooseDocumentEvents[],
    callback: MongooseDocumentEventCallback): void => {
    eventsToListen.forEach(event => {
        Object.values(mongoose.models).forEach(model => {
            model.on(event, async (context: MongooseDocumentEventsContext) => {
                await callback(context, cacheClients)
            })
        })
    })
}

const wasRecordDeleted = <T>(record: Document<T>, options: MongooseCacheAutoCleanerOptions): boolean => {
    if (record && options?.wasRecordDeletedCallback) {
        return options.wasRecordDeletedCallback(record)
    }

    return false
}

const appendPreSaveListener = (schema: Schema, options: MongooseCacheAutoCleanerOptions): void => {
    schema.pre('save', function (next) {
        this.$locals.wasNew = this.isNew
        this.$locals.wasDeleted = wasRecordDeleted(this, options)
        const model = getMongooseModelFromDocument(this)

        model.emit(MongooseDocumentEvents.BEFORE_SAVE, this)
        next()
    })
}

const appendPostSaveListener = (schema: Schema): void => {
    schema.post('save', function (record, next) {
        const wasNew = this.$locals.wasNew
        const wasDeleted = this.$locals.wasDeleted
        const model = getMongooseModelFromDocument(record)

        model.emit(MongooseDocumentEvents.AFTER_SAVE, <MongooseDocumentEventsContext>{record, wasNew, wasDeleted, modelName: model.modelName})
        next()
    })
}

const appendPostRemoveListener = (schema: Schema): void => {
    schema.post('remove', function (record, next) {
        const model = getMongooseModelFromDocument(record)

        model.emit(MongooseDocumentEvents.AFTER_REMOVE, <MongooseDocumentEventsContext>{record, wasDeleted: true, modelName: model.modelName})
        next()
    })
}

export const MongooseCacheAutoCleaner = (schema: Schema, options: MongooseCacheAutoCleanerOptions): void => {
    appendPreSaveListener(schema, options)
    appendPostSaveListener(schema)
    appendPostRemoveListener(schema)
}
