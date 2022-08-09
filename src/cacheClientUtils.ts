import Keyv from "keyv"
import {Document, Model} from 'mongoose'
import {Container} from 'typedi'
import {CacheClients, CachedDocument, CachedResult, GlobalDiContainerRegistryNames, SpeedGooseCacheOperationParams} from "./types/types"
import {generateCacheKeyForModelName, isResultWithIds, makeArrayUnique} from "./utils"

const clearKeysInCache = async <T>(keysToClean: string[], cacheClient: Keyv<T>): Promise<void> => {
    if (keysToClean && Array.isArray(keysToClean)) {
        await Promise.all(keysToClean.map(keyToClean =>
            cacheClient.delete(keyToClean)
        ))
    }
}

const setKeyInSingleRecordsCache = async <T>(document: Document<T>, key: string, params: SpeedGooseCacheOperationParams, cacheClients: CacheClients): Promise<void> => {
    await cacheClients.singleRecordsCache.set(key, document, params.ttl * 1000)
}

const setKeyInSingleRecordsKeyCache = async <T>(document: Document<T>, key: string, params: SpeedGooseCacheOperationParams, cacheClients: CacheClients): Promise<void> => {
    const recordId  = String(document._id)
    const existingCacheEntry = await cacheClients.singleRecordsKeyCache.get(recordId) ?? []
    await cacheClients.singleRecordsKeyCache.set(recordId, makeArrayUnique([...existingCacheEntry, key]), params.ttl * 1000)
}

const setKeyInResultsCache = async <T extends CachedResult>(results: T, params: SpeedGooseCacheOperationParams, cacheClients: CacheClients): Promise<void> => {
    await cacheClients.resultsCache.set(params.cacheKey, results, params.ttl * 1000)
}

const setKeyInModelCache = async <T>(model: Model<T>, params: SpeedGooseCacheOperationParams, cacheClients: CacheClients): Promise<void> => {
    const modelCacheKey = generateCacheKeyForModelName(model, params.multitenantValue)
    const existingCacheEntry = await cacheClients.modelsKeyCache.get(modelCacheKey) ?? []
    await cacheClients.modelsKeyCache.set(modelCacheKey, makeArrayUnique([...existingCacheEntry, params.cacheKey]), params.ttl * 1000)
}

const setKeyInRecordsCache = async (result: CachedDocument, params: SpeedGooseCacheOperationParams, cacheClients: CacheClients): Promise<void> => {
    const resultsIds = Array.isArray(result) ? result.map(record => record._id) : [result._id]

    for (const id of resultsIds) {
        const existingCacheEntry = await cacheClients.recordsKeyCache.get(String(id)) ?? []
        await cacheClients.recordsKeyCache.set(String(id), makeArrayUnique([...existingCacheEntry, params.cacheKey]), params.ttl * 1000)
    }
}

export const getCacheClients = (): CacheClients =>
    Container.get<CacheClients>(GlobalDiContainerRegistryNames.CACHE_CLIENT_GLOBAL_ACCESS)

export const clearCacheForKey = async (key: string): Promise<void> => {
    const cacheClients = Container.get<CacheClients>(GlobalDiContainerRegistryNames.CACHE_CLIENT_GLOBAL_ACCESS)
    await clearCacheOnClientForKey(key, cacheClients.recordsKeyCache, cacheClients)
}

export const clearCacheOnClientForKey = async <T extends string[]>(key: string, contextCacheClient: Keyv<T>, cacheClients: CacheClients): Promise<void> => {
    const keysToClean = await contextCacheClient.get(key)

    await clearKeysInCache(keysToClean, cacheClients.resultsCache)
    await cacheClients.modelsKeyCache.delete(key)
    await contextCacheClient.delete(key)
}

export const clearHydrationCache = async (key: string, cacheClients: CacheClients): Promise<void> => {
    const keysToClean = await cacheClients.singleRecordsKeyCache.get(key)
    await clearKeysInCache(keysToClean, cacheClients.singleRecordsCache)
    await cacheClients.singleRecordsKeyCache.delete(key)
}

export const setKeyInResultsCaches = async <T extends CachedResult, M>(params: SpeedGooseCacheOperationParams, result: T, model: Model<M>, cacheClients: CacheClients): Promise<void> => {
    await setKeyInResultsCache(result, params, cacheClients)
    await setKeyInModelCache(model, params, cacheClients)

    if (isResultWithIds(result)) {
        await setKeyInRecordsCache(result as CachedDocument, params, cacheClients)
    }
}

export const setKeyInHydrationCaches = async <T>(key: string, document: Document<T>, params: SpeedGooseCacheOperationParams, cacheClients: CacheClients): Promise<void> => {
    await setKeyInSingleRecordsCache(document, key, params, cacheClients)
    await setKeyInSingleRecordsKeyCache(document, key, params, cacheClients)
}
