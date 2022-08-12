import {Mongoose} from "mongoose"
import {clearResultsCacheOnClientForKey, clearHydrationCache} from "./cacheClientUtils"
import {CacheClients, MongooseDocumentEventCallback, MongooseDocumentEvents, MongooseDocumentEventsContext} from "./types/types"
import {generateCacheKeyForRecordAndModelName} from "./utils"

const clearModelCache = async (context: MongooseDocumentEventsContext, cacheClients: CacheClients): Promise<void> => {
    const modelCacheKey = generateCacheKeyForRecordAndModelName(context.record, context.modelName)

    await clearResultsCacheOnClientForKey(modelCacheKey, cacheClients.modelsKeyCache, cacheClients)
}

const clearCacheForRecordCallback = async (context: MongooseDocumentEventsContext, cacheClients: CacheClients): Promise<void> => {
    const recordId = String(context.record._id)
    await clearResultsCacheOnClientForKey(recordId, cacheClients.recordsKeyCache, cacheClients)
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


export const registerListenerForInternalEvents = (mongoose: Mongoose, cacheClients: CacheClients): void => {
    listenOnInternalEvents(mongoose, cacheClients, [MongooseDocumentEvents.BEFORE_SAVE, MongooseDocumentEvents.AFTER_REMOVE], clearCacheForRecordCallback)
}