import {Mongoose, Query} from "mongoose"
import {CachedDocument, CachedResult, CacheNamespaces, SpeedGooseCacheOperationParams} from "./types/types"
import {setKeyInResultsCaches} from "./utils/cacheClientUtils"
import {hydrateResults} from "./utils/hydrationUtils"
import {isCountQuery, isLeanQuery, prepareQueryOperationParams} from "./utils/queryUtis"
import {getValueFromCache} from "./utils/redisUtils"

export const addCachingToQuery = (mongoose: Mongoose): void => {
    /** 
     * Caches given query based operation. 
    */
    mongoose.Query.prototype.cacheQuery = function <T>(params: SpeedGooseCacheOperationParams = {}): Promise<Query<CachedResult | CachedResult[], any>> {
        return execQueryWithCache<T>(this, params)
    }
}

const prepareQueryResults = async <T extends CachedResult>(
    query: Query<T, T>,
    params: SpeedGooseCacheOperationParams,
    result: CachedResult,
): Promise<CachedResult | CachedResult[]> => {
    return isLeanQuery(query) || isCountQuery(query) ? result : await hydrateResults(query, params, result as CachedDocument)
}

const execQueryWithCache = async <T extends CachedResult>(
    query: Query<T, T>,
    params: SpeedGooseCacheOperationParams
): Promise<Query<CachedResult | CachedResult[], any>> => {
    prepareQueryOperationParams(query, params)

    const cachedValue = await getValueFromCache(CacheNamespaces.RESULTS_NAMESPACE, params.cacheKey)

    if (cachedValue) return prepareQueryResults(query, params, cachedValue)

    const result = await query.exec()

    if (result) {
        await setKeyInResultsCaches(params, result, query.model)

        return prepareQueryResults(query, params, result)
    }
}
