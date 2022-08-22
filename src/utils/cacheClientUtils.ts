import Keyv from "keyv"
import {Document, Model} from 'mongoose'
import {CachedDocument, CachedResult, CacheNamespaces, SpeedGooseCacheOperationParams} from "../types/types"
import {generateCacheKeyForModelName} from "./cacheKeyUtils"
import {getHydrationCache, getHydrationVariationsCache} from "./commonUtils"
import {isResultWithIds} from "./mongooseUtils"
import {addValueToCache, addValueToCacheSet, addValueToManyCachedSets, clearResultsCacheWithSet, removeKeyFromCache} from "./redisUtils"

const clearKeysInCache = async <T>(keysToClean: string[], cacheClient: Keyv<T>): Promise<void> => {
    if (keysToClean && Array.isArray(keysToClean)) {
        await Promise.all(keysToClean.map(keyToClean =>
            cacheClient.delete(keyToClean)
        ))
    }
}

const setKeyInHydratedDocumentsCache = async <T>(document: Document<T>, key: string, params: SpeedGooseCacheOperationParams): Promise<void> => {
    await getHydrationCache().set(key, document, params.ttl * 1000)
}

// Todo -> Try to prevent corner case with overwriting of this set
const setKeyInHydatedDocumentsVariationsCache = async <T>(document: Document<T>, key: string, params: SpeedGooseCacheOperationParams): Promise<void> => {
    const recordId = String(document._id)
    const recordVariationsSet = await getHydrationVariationsCache().get(recordId) ?? new Set()

    recordVariationsSet.add(params.cacheKey)
    await getHydrationVariationsCache().set(recordId, recordVariationsSet)
}

const setKeyInResultsCache = async <T extends CachedResult>(results: T, params: SpeedGooseCacheOperationParams): Promise<void> =>
    addValueToCache(CacheNamespaces.RESULTS_NAMESPACE, params.cacheKey, results)

const setKeyInModelCache = async <T>(model: Model<T>, params: SpeedGooseCacheOperationParams): Promise<void> => {
    const modelCacheKey = generateCacheKeyForModelName(model.modelName, params.multitenantValue)

    await addValueToCacheSet(modelCacheKey, params.cacheKey)
}

const setKeyInRecordsCache = async (result: CachedDocument, params: SpeedGooseCacheOperationParams): Promise<void> => {
    const resultsIds = Array.isArray(result) ? result.map(record => String(record._id)) : [String(result._id)]
    // Todo -> replace this logic with redis pipeline call
    if (resultsIds) {
        addValueToManyCachedSets(resultsIds, params.cacheKey)
    }
}

/** 
 * Can be used for manually clearing cache for given cache key
 * @param {string} key cache key
*/
export const clearCacheForKey = async (key: string): Promise<void> => {
    await removeKeyFromCache(CacheNamespaces.RESULTS_NAMESPACE, key)
}

/** 
 * Can be used for manually clearing cache for given modelName. 
 * @param {string} modelName name of registerd mongoose model
 * @param {string} multitenantValue [optional] unique value of your tenant
*/
export const clearCachedResultsForModel = async (modelName: string, multitenantValue?: string): Promise<void> => {
    const modelCacheKey = generateCacheKeyForModelName(modelName, multitenantValue)
    await clearResultsCacheWithSet(modelCacheKey)
}

export const clearHydrationCache = async (recordId: string): Promise<void> => {
    const hydratedDocumentVariations = await getHydrationVariationsCache().get(recordId)
    if (hydratedDocumentVariations?.size > 0) {
        await clearKeysInCache(Array.from(hydratedDocumentVariations), getHydrationCache())
        await getHydrationVariationsCache().delete(recordId)
    }
}

export const setKeyInResultsCaches = async <T extends CachedResult, M>(params: SpeedGooseCacheOperationParams, result: T, model: Model<M>): Promise<void> => {
    await setKeyInResultsCache(result, params)
    await setKeyInModelCache(model, params)

    if (isResultWithIds(result)) {
        await setKeyInRecordsCache(result as CachedDocument, params)
    }
}

export const setKeyInHydrationCaches = async <T>(key: string, document: Document<T>, params: SpeedGooseCacheOperationParams): Promise<void> => {
    await setKeyInHydratedDocumentsCache(document, key, params)
    await setKeyInHydatedDocumentsVariationsCache(document, key, params)
}
