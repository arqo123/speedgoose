import {Mongoose} from "mongoose"
import {MongooseDocumentEventCallback, MongooseDocumentEvents, MongooseDocumentEventsContext, SpeedGooseDebuggerOperations} from "./types/types"
import {clearCacheForRecordId} from "./utils/cacheClientUtils"
import {generateCacheKeyForRecordAndModelName} from "./utils/cacheKeyUtils"
import {getCacheStrategyInstance} from "./utils/commonUtils"
import {getDebugger} from "./utils/debugUtils"

const clearModelCache = async (context: MongooseDocumentEventsContext): Promise<void> => {
    const modelCacheKey = generateCacheKeyForRecordAndModelName(context.record, context.modelName)
    context?.debug(`Clearing model cache for key`, modelCacheKey)

    await getCacheStrategyInstance().clearResultsCacheWithSet(modelCacheKey)
}

const clearCacheForRecordCallback = async (context: MongooseDocumentEventsContext): Promise<void> => {
    await clearCacheForRecordId(context.record._id)
    if (context.wasNew || context.wasDeleted) {
        await clearModelCache(context)
    }
}

const prepareDocumentEventContext = (context: MongooseDocumentEventsContext): void => {
    context.debug = getDebugger(context.modelName, SpeedGooseDebuggerOperations.EVENTS)
}

const listenOnInternalEvents = (
    mongoose: Mongoose,
    eventsToListen: MongooseDocumentEvents[],
    callback: MongooseDocumentEventCallback): void => {
    eventsToListen.forEach(event => {
        Object.values(mongoose?.models ?? {}).forEach(model => {
            model.on(event, async (context: MongooseDocumentEventsContext) => {
                prepareDocumentEventContext(context)
                await callback(context)
            })
        })
    })
}

export const registerListenerForInternalEvents = (mongoose: Mongoose): void => {
    listenOnInternalEvents(mongoose, [MongooseDocumentEvents.BEFORE_SAVE, MongooseDocumentEvents.AFTER_REMOVE], clearCacheForRecordCallback)
}