import Keyv from 'keyv';
import { Container } from 'typedi';
import { Model, ObjectId } from 'mongoose';
import { SpeedGooseConfig, SpeedGooseRedisChannels } from '../types/types';
import { GlobalDiContainerRegistryNames } from '../types/types';
import { CachedDocument, CachedResult, CacheNamespaces, SpeedGooseCacheOperationContext, SpeedGooseCacheOperationParams } from '../types/types';
import { generateCacheKeyForModelName } from './cacheKeyUtils';
import { getCacheStrategyInstance, getConfig, objectDeserializer, objectSerializer } from './commonUtils';
import { logCacheClear } from './debugUtils';
import { isResultWithIds } from './mongooseUtils';
import { scheduleTTlRefreshing } from './queueUtils';
import { ExpiringMap } from './expiringMap';
import { publishRecordIdsOnChannel } from './redisUtils';

export const getSetsTtl = (): number => {
    const config = getConfig();
    if (config?.setsTtl !== undefined) return config.setsTtl;
    const defaultTtl = config?.defaultTtl ?? 60;
    return defaultTtl * 2;
};

/** TTL for the invalidation sets a cached value is tracked in: never shorter than the value's own TTL, so it can always be invalidated. 0 = no expiry. */
export const getSetsTtlFor = (ttl?: number): number => {
    const setsTtl = getSetsTtl();
    return setsTtl > 0 ? Math.max(setsTtl, ttl ?? 0) : setsTtl;
};

export const getMaxSetCardinality = (): number => {
    const config = getConfig();
    if (config?.maxSetCardinality !== undefined) return config.maxSetCardinality;
    return 10000;
};

const setKeyInResultsCache = async <T>(results: CachedResult<T>, params: SpeedGooseCacheOperationParams): Promise<void> => getCacheStrategyInstance().addValueToCache(CacheNamespaces.RESULTS_NAMESPACE, params.cacheKey, results, params.ttl);

const setKeyInModelCache = async <T>(model: Model<T>, params: SpeedGooseCacheOperationParams): Promise<void> => {
    const modelCacheKey = generateCacheKeyForModelName(model.modelName, params.multitenantValue);

    await getCacheStrategyInstance().addValueToCacheSet(modelCacheKey, params.cacheKey, getSetsTtlFor(params.ttl), getMaxSetCardinality());
};

const setKeyInRecordsCache = async <T>(result: CachedDocument<T>, params: SpeedGooseCacheOperationParams): Promise<void> => {
    const resultsIds = Array.isArray(result) ? result.map(record => String(record._id)) : [String(result._id)];

    if (resultsIds.length > 0) {
        await getCacheStrategyInstance().addValueToManyCachedSets(resultsIds, params.cacheKey, getSetsTtlFor(params.ttl), getMaxSetCardinality());
    }
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
    logCacheClear(`Clearing results and documents cache for recordId`, recordId);
    await Promise.all([getCacheStrategyInstance().clearResultsCacheWithSet(recordId), getCacheStrategyInstance().clearDocumentsCache(recordId)]);
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

const setKeyInInvalidationSets = async <T>(context: SpeedGooseCacheOperationContext, result: CachedResult<T>, model: Model<T>): Promise<void> => {
    const writes: Promise<void>[] = [setKeyInModelCache(model, context)];
    if (isResultWithIds(result)) {
        writes.push(setKeyInRecordsCache(result as CachedDocument<T>, context));
    }
    await Promise.all(writes);
};

export const setKeyInResultsCaches = async <T>(context: SpeedGooseCacheOperationContext, result: CachedResult<T>, model: Model<T>): Promise<void> => {
    // Defensive guard: cache writes are also bypassed earlier in query/aggregate execution paths for ttl <= 0.
    if (context?.ttl !== undefined && context.ttl <= 0) {
        context?.debug?.(`Skipping cache write because ttl <= 0`, context.cacheKey);
        return;
    }

    context?.debug(`Setting key in cache`, context.cacheKey);
    // The result goes first: writing to an invalidation set drops members whose result key does not exist.
    await setKeyInResultsCache(result, context);
    await setKeyInInvalidationSets(context, result, model);

    context?.debug(`Cache key set`, context.cacheKey);
};

export const createInMemoryCacheClientWithNamespace = <T>(namespace: string) =>
    new Keyv<T>(
        //@ts-expect-error There is a incorrect typo in the library for custom serializers
        {
            namespace,
            store: new ExpiringMap(),
            serialize: objectSerializer,
            deserialize: objectDeserializer,
        },
    );

export const getResultsFromCache = async (key: string): Promise<CachedResult | null> => getCacheStrategyInstance().getValueFromCache(CacheNamespaces.RESULTS_NAMESPACE, key);

export const isCached = async (key: string): Promise<boolean> => getCacheStrategyInstance().isValueCached(CacheNamespaces.RESULTS_NAMESPACE, key);

// The invalidation sets only need the ids. Take them now, because the caller may change the result before the timer runs.
const toInvalidationSource = <T>(value: CachedResult<T>): CachedResult<T> => {
    if (!isResultWithIds(value)) return value;

    return (Array.isArray(value) ? value.map(record => ({ _id: (record as CachedDocument<T>)?._id })) : { _id: (value as CachedDocument<T>)._id }) as CachedResult<T>;
};

export const refreshTTLTimeIfNeeded = <T>(context: SpeedGooseCacheOperationContext, cachedValue: CachedResult<T>, model?: Model<T>): void => {
    if (context.refreshTtlOnRead) {
        const invalidationSource = toInvalidationSource(cachedValue);
        setTimeout(async () => {
            try {
                const scheduled = await scheduleTTlRefreshing(context);
                // The result now outlives its invalidation sets' TTL; extend them too or it can no longer be invalidated.
                if (scheduled && model) await setKeyInInvalidationSets(context, invalidationSource, model);
            } catch (error) {
                context?.debug?.(`Refreshing TTL failed`, error);
            }
        }, 0);
    }
};

// Tracked parents are stored as `<modelName>:<recordId>`; a string _id may itself contain ':'.
const getRecordIdFromParentIdentifier = (parentIdentifier: string): string => parentIdentifier.slice(parentIdentifier.indexOf(':') + 1);

export const clearParentCacheBulk = async (modelName: string, docIds: (string | ObjectId)[]): Promise<void> => {
    if (docIds.length === 0) return;

    const cacheStrategy = getCacheStrategyInstance();
    const config = Container.get<SpeedGooseConfig>(GlobalDiContainerRegistryNames.CONFIG_GLOBAL_ACCESS);
    const CACHE_PARENT_LIMIT = Math.max(1, Number.isFinite(config.cacheParentLimit) ? config.cacheParentLimit : 100);

    const childIdentifiers = docIds.map(docId => `${CacheNamespaces.RELATIONS_CHILD_TO_PARENT}:${modelName}:${docId}`);

    // Fetch all parent sets in parallel
    const parentSets = await Promise.all(childIdentifiers.map(id => cacheStrategy.getParentsOfChild(id)));

    // Collect unique parent record IDs across all children
    const uniqueParentRecordIds = new Set<string>();
    for (const parentIdentifiers of parentSets) {
        for (const parentIdWithModel of parentIdentifiers) {
            const id = getRecordIdFromParentIdentifier(parentIdWithModel);
            if (id) uniqueParentRecordIds.add(id);
            if (uniqueParentRecordIds.size >= CACHE_PARENT_LIMIT) break;
        }
        if (uniqueParentRecordIds.size >= CACHE_PARENT_LIMIT) break;
    }

    if (uniqueParentRecordIds.size >= CACHE_PARENT_LIMIT) {
        console.warn(`[SpeedGoose] Parent cache invalidation truncated at ${CACHE_PARENT_LIMIT} for model "${modelName}". Some parent caches may be stale. Increase cacheParentLimit in config to cover all parents.`);
    }

    try {
        // Invalidate unique parents in batches
        if (uniqueParentRecordIds.size > 0) {
            logCacheClear(`Bulk invalidating ${uniqueParentRecordIds.size} unique parents for ${docIds.length} children`, modelName);
            // Only instances running an older speedgoose version still cache these parents locally. This message keeps them
            // up to date during a rolling deploy. Remove it in a later version.
            await publishRecordIdsOnChannel(SpeedGooseRedisChannels.RECORDS_CHANGED, Array.from(uniqueParentRecordIds));

            const BATCH_SIZE = 25;
            const uniqueIds = Array.from(uniqueParentRecordIds);
            const batchCount = Math.ceil(uniqueIds.length / BATCH_SIZE);

            for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
                const batch = uniqueIds.slice(batchIndex * BATCH_SIZE, (batchIndex + 1) * BATCH_SIZE);
                await Promise.all(batch.map(id => clearCacheForRecordId(id)));

                if (batchIndex < batchCount - 1) {
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }
        }
    } finally {
        // Always clean up child relationships, even if invalidation fails
        await Promise.all(childIdentifiers.map(id => cacheStrategy.removeChildRelationships(id)));
    }
};

export const clearParentCache = async (modelName: string, docId: string | ObjectId): Promise<void> => {
    const childIdentifier = `${CacheNamespaces.RELATIONS_CHILD_TO_PARENT}:${modelName}:${docId}`;

    const cacheStrategy = getCacheStrategyInstance();
    const parentIdentifiers = await cacheStrategy.getParentsOfChild(childIdentifier);

    const config = Container.get<SpeedGooseConfig>(GlobalDiContainerRegistryNames.CONFIG_GLOBAL_ACCESS);
    const CACHE_PARENT_LIMIT = Math.max(1, Number.isFinite(config.cacheParentLimit) ? config.cacheParentLimit : 100);

    try {
        if (parentIdentifiers.length > 0) {
            logCacheClear(`Invalidating ${parentIdentifiers.length} parents for child`, `${modelName}:${docId}`);
            // Only instances running an older speedgoose version still cache these parents locally. This message keeps them
            // up to date during a rolling deploy. Remove it in a later version.
            await publishRecordIdsOnChannel(SpeedGooseRedisChannels.RECORDS_CHANGED, parentIdentifiers.slice(0, CACHE_PARENT_LIMIT).map(getRecordIdFromParentIdentifier));

            if (parentIdentifiers.length > CACHE_PARENT_LIMIT) {
                console.warn(`[SpeedGoose] Parent cache invalidation truncated at ${CACHE_PARENT_LIMIT} for "${modelName}:${docId}". ${parentIdentifiers.length - CACHE_PARENT_LIMIT} parents skipped. Increase cacheParentLimit in config.`);
            }

            // Process in batches with delay up to CACHE_PARENT_LIMIT
            const BATCH_SIZE = 25;

            // Process batches with proper limit enforcement
            const batchCount = Math.ceil(Math.min(parentIdentifiers.length, CACHE_PARENT_LIMIT) / BATCH_SIZE);

            for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
                const batchStart = batchIndex * BATCH_SIZE;
                const batchEnd = Math.min(batchStart + BATCH_SIZE, CACHE_PARENT_LIMIT);
                const batch = parentIdentifiers.slice(batchStart, batchEnd);

                await Promise.all(
                    batch.map(async parentIdWithModel => {
                        const id = getRecordIdFromParentIdentifier(parentIdWithModel);
                        if (id) {
                            await clearCacheForRecordId(id);
                        }
                    }),
                );

                // Add delay between batches except last
                if (batchIndex < batchCount - 1) {
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }
        }
    } finally {
        // Always clean up child relationships, even if invalidation fails
        await cacheStrategy.removeChildRelationships(childIdentifier);
    }
};
