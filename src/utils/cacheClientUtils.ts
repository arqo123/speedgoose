import Keyv from 'keyv';
import { Container } from 'typedi';
import { Document, Model, ObjectId } from 'mongoose';
import { SpeedGooseConfig } from '../types/types';
import { GlobalDiContainerRegistryNames } from '../types/types';
import { CachedDocument, CachedResult, CacheNamespaces, SpeedGooseCacheOperationContext, SpeedGooseCacheOperationParams } from '../types/types';
import { generateCacheKeyForModelName } from './cacheKeyUtils';
import { getCacheStrategyInstance, getHydrationCache, getHydrationVariationsCache, objectDeserializer, objectSerializer } from './commonUtils';
import { logCacheClear } from './debugUtils';
import { isResultWithIds } from './mongooseUtils';
import { getCachedSetsQueue, scheduleTTlRefreshing } from './queueUtils';

const clearKeysInCache = async <T>(keysToClean: string[], cacheClient: Keyv<T>): Promise<void> => {
    if (keysToClean && Array.isArray(keysToClean)) {
        await Promise.all(keysToClean.map(keyToClean => cacheClient.delete(keyToClean)));
    }
};

const setKeyInHydratedDocumentsCache = async <T>(document: CachedDocument<T>, key: string, params: SpeedGooseCacheOperationParams): Promise<void> => {
    await getHydrationCache().set(key, document, params.ttl * 1000);
};

const setKeyInHydratedDocumentsVariationsCache = async <T>(document: Document<T>, key: string): Promise<void> => {
    const recordId = String(document._id);
    await addValueToInternalCachedSet(getHydrationVariationsCache(), recordId, key);
};

const setKeyInResultsCache = async <T>(results: CachedResult<T>, params: SpeedGooseCacheOperationParams): Promise<void> => getCacheStrategyInstance().addValueToCache(CacheNamespaces.RESULTS_NAMESPACE, params.cacheKey, results, params.ttl);

const setKeyInModelCache = async <T>(model: Model<T>, params: SpeedGooseCacheOperationParams): Promise<void> => {
    const modelCacheKey = generateCacheKeyForModelName(model.modelName, params.multitenantValue);

    await getCacheStrategyInstance().addValueToCacheSet(modelCacheKey, params.cacheKey);
};

const setKeyInRecordsCache = async <T>(result: CachedDocument<T>, params: SpeedGooseCacheOperationParams): Promise<void> => {
    const resultsIds = Array.isArray(result) ? result.map(record => String(record._id)) : [String(result._id)];

    if (resultsIds) {
        getCacheStrategyInstance().addValueToManyCachedSets(resultsIds, params.cacheKey);
    }
};

export const addValueToInternalCachedSet = async <T extends string | number>(client: Keyv<Set<string | number>>, namespace: string, value: T): Promise<void> => {
    await getCachedSetsQueue().push({ client, namespace, value });
};

/**
 * Can be used for manually clearing cache for given cache key
 * @param {string} key cache key
 */
export const clearCacheForKey = async (key: string): Promise<void> => {
    logCacheClear(`Clearing results cache for key`, key);
    await getCacheStrategyInstance().removeKeyForCache(CacheNamespaces.RESULTS_NAMESPACE, key);
};

/**
 * Can be used for manually clearing cache for given recordId,
 * useful when performing silent updates of record
 * @param {string} key cache key
 */
export const clearCacheForRecordId = async (recordId: string): Promise<void> => {
    recordId = String(recordId);
    logCacheClear(`Clearing results and hydration cache for recordId`, recordId);
    await Promise.all([getCacheStrategyInstance().clearResultsCacheWithSet(recordId), clearHydrationCache(recordId), getCacheStrategyInstance().clearDocumentsCache(recordId)]);
};

/**
 * Can be used for manually clearing cache for given modelName.
 * @param {string} modelName name of registered mongoose model
 * @param {string} multitenantValue [optional] unique value of your tenant
 */
export const clearCachedResultsForModel = async (modelName: string, multitenantValue?: string): Promise<void> => {
    const modelCacheKey = generateCacheKeyForModelName(modelName, multitenantValue);
    logCacheClear(`Clearing model cache for key`, modelCacheKey);

    await getCacheStrategyInstance().clearResultsCacheWithSet(modelCacheKey);
};

export const clearHydrationCache = async (recordId: string): Promise<void> => {
    logCacheClear(`Clearing hydration cache for recordId`, recordId);

    const hydratedDocumentVariations = await getHydrationVariationsCache().get(recordId);
    if (hydratedDocumentVariations?.size > 0) {
        await clearKeysInCache(Array.from(hydratedDocumentVariations), getHydrationCache());
        await getHydrationVariationsCache().delete(recordId);
    }
};

export const setKeyInResultsCaches = async <T>(context: SpeedGooseCacheOperationContext, result: CachedResult<T>, model: Model<T>): Promise<void> => {
    context?.debug(`Setting key in cache`, context.cacheKey);
    await setKeyInResultsCache(result, context);
    await setKeyInModelCache(model, context);

    if (isResultWithIds(result)) {
        await setKeyInRecordsCache(result as CachedDocument<T>, context);
    }

    context?.debug(`Cache key set`, context.cacheKey);
};

export const setKeyInHydrationCaches = async <T>(key: string, document: CachedDocument<T>, params: SpeedGooseCacheOperationParams): Promise<void> => {
    await setKeyInHydratedDocumentsCache(document, key, params);
    await setKeyInHydratedDocumentsVariationsCache(document, key);
};

export const createInMemoryCacheClientWithNamespace = <T>(namespace: string) =>
    new Keyv<T>(
        //@ts-expect-error There is a incorrect typo in the library for custom serializers
        {
            namespace,
            serialize: objectSerializer,
            deserialize: objectDeserializer,
        },
    );

export const getResultsFromCache = async (key: string): Promise<CachedResult> => getCacheStrategyInstance().getValueFromCache(CacheNamespaces.RESULTS_NAMESPACE, key);

export const isCached = async (key: string): Promise<boolean> => getCacheStrategyInstance().isValueCached(CacheNamespaces.RESULTS_NAMESPACE, key);

export const refreshTTLTimeIfNeeded = <T>(context: SpeedGooseCacheOperationContext, cachedValue: CachedResult<T>): void => {
    if (context.refreshTtlOnRead) {
        setTimeout(() => {
            scheduleTTlRefreshing(context, cachedValue);
        }, 0);
    }
};

export const clearParentCache = async (modelName: string, docId: string| ObjectId): Promise<void> => {
     const childIdentifier = `${CacheNamespaces.RELATIONS_CHILD_TO_PARENT}:${modelName}:${docId}`;
    
    const cacheStrategy = getCacheStrategyInstance();
    const parentIdentifiers = await cacheStrategy.getParentsOfChild(childIdentifier);
    
    const config = Container.get<SpeedGooseConfig>(GlobalDiContainerRegistryNames.CONFIG_GLOBAL_ACCESS);
    const CACHE_PARENT_LIMIT = Math.max(1,
        Number.isFinite(config.cacheParentLimit) ? config.cacheParentLimit : 100
    );
    
    if (parentIdentifiers.length > 0) {
        logCacheClear(`Invalidating ${parentIdentifiers.length} parents for child`, `${modelName}:${docId}`);

        // Process in batches with delay up to CACHE_PARENT_LIMIT
        const BATCH_SIZE = 25;

        // Process batches with proper limit enforcement
        const batchCount = Math.ceil(Math.min(parentIdentifiers.length, CACHE_PARENT_LIMIT) / BATCH_SIZE);
        
        for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
            const batchStart = batchIndex * BATCH_SIZE;
            const batchEnd = Math.min(batchStart + BATCH_SIZE, CACHE_PARENT_LIMIT);
            const batch = parentIdentifiers.slice(batchStart, batchEnd);
            
            await Promise.all(batch.map(async parentIdWithModel => {
                const id = parentIdWithModel.split(':').pop();
                await clearCacheForRecordId(id!);
            }));
            
            // Add delay between batches except last
            if (batchIndex < batchCount - 1) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }
    }

    await cacheStrategy.removeChildRelationships(childIdentifier);
};
