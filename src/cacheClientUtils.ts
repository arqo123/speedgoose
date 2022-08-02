import Keyv from "keyv"
import {Container} from 'typedi'
import {SPEEDGOOSE_CACHE_LAYER_GLOBAL_ACCESS} from "./constants"
import {CacheClients} from "./types/types"

const clearKeysInCache = async <T>(keysToClean: string[], cacheClient: Keyv<T>): Promise<void> => {
    if (keysToClean && Array.isArray(keysToClean)) {
        await Promise.all(keysToClean.map(keyToClean =>
            cacheClient.delete(keyToClean)
        ))
    }
}

export const clearCacheForKey = async (key: string): Promise<void> => {
    const cacheClients = Container.get<CacheClients>(SPEEDGOOSE_CACHE_LAYER_GLOBAL_ACCESS)
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
