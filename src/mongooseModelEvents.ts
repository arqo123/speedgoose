import { Mongoose } from 'mongoose';
import { DocumentWithIdAndTenantValue, MongooseDocumentEventCallback, MongooseDocumentEvents, MongooseDocumentEventsContext, MongooseInternalEventContext, MongooseManyObjectOperationEventContext, SpeedGooseDebuggerOperations } from './types/types';
import { clearCacheForRecordId } from './utils/cacheClientUtils';
import { getCacheStrategyInstance } from './utils/commonUtils';
import { getDebugger } from './utils/debugUtils';

const clearModelCache = async (context: MongooseDocumentEventsContext): Promise<void> => {
     context?.debug(`Clearing model cache for model name ${context.modelName}_`, context.modelName);

    await getCacheStrategyInstance().clearResultsCacheWithSet(`${context.modelName}_`);
};

const clearCacheForRecordCallback = async (context: MongooseDocumentEventsContext): Promise<void> => {
    await clearCacheForRecordId(context.record._id);
    if (context.wasNew || context.wasDeleted) {
        await clearModelCache(context);
    }
};

const prepareDocumentEventContext = (context: MongooseDocumentEventsContext): void => {
    context.debug = getDebugger(context.modelName, SpeedGooseDebuggerOperations.EVENTS);
};

const prepareContextForSingleRecord = (record: DocumentWithIdAndTenantValue, context: MongooseInternalEventContext): MongooseInternalEventContext => {
    return { record: record, modelName: context.modelName, debug: context.debug, wasDeleted: context.wasDeleted };
};

const listenOnInternalEvents = (mongoose: Mongoose, callback: MongooseDocumentEventCallback): void => {
    [MongooseDocumentEvents.MANY_DOCUMENTS_CHANGED, MongooseDocumentEvents.SINGLE_DOCUMENT_CHANGED].forEach(event => {
        Object.values(mongoose?.models ?? {}).forEach(model => {
            model.on(event, async (context: MongooseInternalEventContext) => {
                prepareDocumentEventContext(context);

                if (event === MongooseDocumentEvents.SINGLE_DOCUMENT_CHANGED) {
                    await callback(context);
                } else {
                    const records = (context as MongooseManyObjectOperationEventContext).records;
                    await Promise.all(records.map(record => callback(prepareContextForSingleRecord(record, context))));
                }
            });
        });
    });
};

export const registerListenerForInternalEvents = (mongoose: Mongoose): void => {
    listenOnInternalEvents(mongoose, clearCacheForRecordCallback);
};
