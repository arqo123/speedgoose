
import {Mongoose, DocumentQuery, Query} from "mongoose"
import {setKeyInResultsCaches} from "./cacheClientUtils"
import {hydrateResults} from "./hydrationUtils"
import {CacheClients, CachedDocument, CachedResult, SpeedGooseCacheOperationParams} from "./types/types"
import {isCountQuery, isLeanQuery, prepareQueryOperationParams} from "./utils"

export const addCachingToQuery = (mongoose: Mongoose, cacheClients: CacheClients): void => {
    /** 
     * Caches given query based operation. 
    */
    mongoose.Query.prototype.cacheQuery = function <T>(params: SpeedGooseCacheOperationParams = {}): Promise<DocumentQuery<CachedResult | CachedResult[], any>> {
        return execQueryWithCache<T>(this, cacheClients, params)
    }
}

const prepareQueryResults = async <T extends CachedResult>(
    query: Query<T, T>,
    params: SpeedGooseCacheOperationParams,
    result: CachedResult,
    cacheClients: CacheClients
): Promise<CachedResult | CachedResult[]> => {
    return isLeanQuery(query) || isCountQuery(query) ? result : await hydrateResults(query, params, result as CachedDocument, cacheClients)
}

const execQueryWithCache = async <T extends CachedResult>(
    query: Query<T, T>,
    cacheClients: CacheClients,
    params: SpeedGooseCacheOperationParams
): Promise<DocumentQuery<CachedResult | CachedResult[], any>> => {
    prepareQueryOperationParams(query, params)

    const cachedValue = await cacheClients.resultsCache.get(params.cacheKey)

    if (cachedValue) return prepareQueryResults(query, params, cachedValue, cacheClients)

    const result = await query.exec()

    if (result) {
        await setKeyInResultsCaches(params, result, query.model, cacheClients)

        return prepareQueryResults(query, params, result, cacheClients)
    }
}
