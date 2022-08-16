import {Mongoose, Query} from "mongoose"
import {CacheClients, CachedDocument, CachedResult, SpeedGooseCacheOperationParams} from "./types/types"
import {setKeyInResultsCaches} from "./utils/cacheClientUtils"
import {hydrateResults} from "./utils/hydrationUtils"
import {isCountQuery, isLeanQuery, prepareQueryOperationParams} from "./utils/queryUtis"

export const addCachingToQuery = (mongoose: Mongoose, cacheClients: CacheClients): void => {
    /** 
     * Caches given query based operation. 
    */
    mongoose.Query.prototype.cacheQuery = function <T>(params: SpeedGooseCacheOperationParams = {}): Promise<Query<CachedResult | CachedResult[], any>> {
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
): Promise<Query<CachedResult | CachedResult[], any>> => {
    prepareQueryOperationParams(query, params)

    const cachedValue = await cacheClients.resultsCache.get(params.cacheKey)

    if (cachedValue) return prepareQueryResults(query, params, cachedValue, cacheClients)

    const result = await query.exec()

    if (result) {
        await setKeyInResultsCaches(params, result, query.model, cacheClients)

        return prepareQueryResults(query, params, result, cacheClients)
    }
}
