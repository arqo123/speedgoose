import {Mongoose} from "mongoose"
import {  MongooseDocumentEventCallback, MongooseDocumentEvents, MongooseDocumentEventsContext} from "./types/types"
import {clearHydrationCache} from "./utils/cacheClientUtils"
import {generateCacheKeyForRecordAndModelName} from "./utils/cacheKeyUtils"
import {clearResultsCacheWithSet} from "./utils/redisUtils"

const clearModelCache = async (context: MongooseDocumentEventsContext): Promise<void> => {
    const modelCacheKey = generateCacheKeyForRecordAndModelName(context.record, context.modelName)

    await clearResultsCacheWithSet(modelCacheKey)
}

const clearCacheForRecordCallback = async (context: MongooseDocumentEventsContext): Promise<void> => {
    const recordId = String(context.record._id)
    await clearResultsCacheWithSet(recordId)
    await clearHydrationCache(recordId)

    if (context.wasNew || context.wasDeleted) {
        await clearModelCache(context)
    }
}

const listenOnInternalEvents = (
    mongoose: Mongoose,
    eventsToListen: MongooseDocumentEvents[],
    callback: MongooseDocumentEventCallback): void => {
    eventsToListen.forEach(event => {
        Object.values(mongoose?.models ?? {}).forEach(model => {
            model.on(event, async (context: MongooseDocumentEventsContext) => {
                await callback(context)
            })
        })
    })
}


export const registerListenerForInternalEvents = (mongoose: Mongoose): void => {
    listenOnInternalEvents(mongoose, [MongooseDocumentEvents.BEFORE_SAVE, MongooseDocumentEvents.AFTER_REMOVE], clearCacheForRecordCallback)
}