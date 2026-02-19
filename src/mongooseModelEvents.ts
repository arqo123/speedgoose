import { Mongoose } from 'mongoose';
import { DocumentWithIdAndTenantValue, MongooseDocumentEventCallback, MongooseDocumentEvents, MongooseDocumentEventsContext, MongooseInternalEventContext, MongooseManyObjectOperationEventContext, SpeedGooseDebuggerOperations } from './types/types';
import { clearCacheForRecordId } from './utils/cacheClientUtils';
import { getCacheStrategyInstance, getConfig } from './utils/commonUtils';
import { getDebugger } from './utils/debugUtils';
import { generateCacheKeyForModelName } from './utils/cacheKeyUtils';

const INTERNAL_EVENT_HANDLER_FLAG = Symbol('speedgoose-internal-event-handler');

const isManyDocumentsContext = (context: MongooseInternalEventContext): context is MongooseManyObjectOperationEventContext => {
    return 'records' in context;
};

const getModelCacheKeysFromContext = (context: MongooseInternalEventContext): string[] => {
    if (!context?.modelName) {
        return [];
    }

    const multitenantKey = getConfig()?.multitenancyConfig?.multitenantKey;
    if (!multitenantKey) {
        return [generateCacheKeyForModelName(context.modelName)];
    }

    const records = isManyDocumentsContext(context)
        ? context.records
        : context.record
            ? [context.record as DocumentWithIdAndTenantValue]
            : [];

    if (records.length === 0) {
        return [generateCacheKeyForModelName(context.modelName)];
    }

    const tenantValues = Array.from(new Set(records.map(record => {
        const value = (record as Record<string, unknown>)?.[multitenantKey];
        // Missing tenant field is treated the same as empty-tenant scope.
        return value == null ? '' : String(value);
    })));

    return tenantValues.map(tenantValue => generateCacheKeyForModelName(context.modelName, tenantValue));
};

const clearModelCache = async (context: MongooseInternalEventContext): Promise<void> => {
    const cacheKeys = getModelCacheKeysFromContext(context);
    context?.debug?.(`Clearing model cache keys`, cacheKeys);

    await Promise.all(cacheKeys.map(cacheKey => getCacheStrategyInstance().clearResultsCacheWithSet(cacheKey)));
};

const shouldClearModelCache = (context: MongooseInternalEventContext): boolean => {
    if (context.wasNew || context.wasDeleted) {
        return true;
    }

    return Boolean(getConfig()?.clearModelCacheOnUpdate);
};

const clearCacheForRecordCallback = async (context: MongooseDocumentEventsContext): Promise<void> => {
    await clearCacheForRecordId(context.record._id);
    if (shouldClearModelCache(context) && !context.modelCacheAlreadyCleared) {
        await clearModelCache(context);
    }
};

const prepareDocumentEventContext = (context: MongooseDocumentEventsContext): void => {
    context.debug = getDebugger(context.modelName, SpeedGooseDebuggerOperations.EVENTS);
};

const prepareContextForSingleRecord = (record: DocumentWithIdAndTenantValue, context: MongooseInternalEventContext): MongooseInternalEventContext => {
    return {
        record: record,
        modelName: context.modelName,
        debug: context.debug,
        wasNew: context.wasNew,
        wasDeleted: context.wasDeleted,
        modelCacheAlreadyCleared: context.modelCacheAlreadyCleared,
    };
};

const listenOnInternalEvents = (mongoose: Mongoose, callback: MongooseDocumentEventCallback): void => {
    [MongooseDocumentEvents.MANY_DOCUMENTS_CHANGED, MongooseDocumentEvents.SINGLE_DOCUMENT_CHANGED].forEach(event => {
        Object.values(mongoose?.models ?? {}).forEach(model => {
            const hasRegisteredInternalHandler = model.listeners(event).some(
                listener => Boolean((listener as Record<symbol, unknown>)[INTERNAL_EVENT_HANDLER_FLAG]),
            );
            if (hasRegisteredInternalHandler) {
                return;
            }

            const handler = async (context: MongooseInternalEventContext): Promise<void> => {
                prepareDocumentEventContext(context);

                if (event === MongooseDocumentEvents.SINGLE_DOCUMENT_CHANGED) {
                    await callback(context);
                } else {
                    const shouldClearInBatch = shouldClearModelCache(context);
                    if (shouldClearInBatch) {
                        await clearModelCache(context);
                        context.modelCacheAlreadyCleared = true;
                    }
                    const records = (context as MongooseManyObjectOperationEventContext).records;
                    await Promise.all(records.map(record => callback(prepareContextForSingleRecord(record, context))));
                }
            };
            (handler as Record<symbol, unknown>)[INTERNAL_EVENT_HANDLER_FLAG] = true;
            model.on(event, handler);
        });
    });
};

export const registerListenerForInternalEvents = (mongoose: Mongoose): void => {
    listenOnInternalEvents(mongoose, clearCacheForRecordCallback);
};
