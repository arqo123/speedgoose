import {Mongoose, Query} from "mongoose"
import {CachedDocument, CachedResult, CacheNamespaces, SpeedGooseCacheOperationContext, SpeedGooseCacheOperationParams} from "./types/types"
import {setKeyInResultsCaches} from "./utils/cacheClientUtils"
import {hydrateResults} from "./utils/hydrationUtils"
import {isCountQuery, isLeanQuery, prepareQueryOperationContext} from "./utils/queryUtils"
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
    context: SpeedGooseCacheOperationContext,
    result: CachedResult,
): Promise<CachedResult | CachedResult[]> => {
    return isLeanQuery(query) || isCountQuery(query) ? result : await hydrateResults(query, context, result as CachedDocument)
}

const execQueryWithCache = async <T extends CachedResult>(
    query: Query<T, T>,
    context: SpeedGooseCacheOperationContext
): Promise<Query<CachedResult | CachedResult[], any>> => {
    prepareQueryOperationContext(query, context)
    
    context?.debug(`Reading cache for key`, context.cacheKey)
    const cachedValue = await getValueFromCache(CacheNamespaces.RESULTS_NAMESPACE, context.cacheKey)

    if (cachedValue) {
        context?.debug(`Returning cache for key`, context.cacheKey)
        return prepareQueryResults(query, context, cachedValue)
    }

    context?.debug(`Key didn't exists in cache, retreaving value from database`, context.cacheKey)
    const result = await query.exec()

    if (result) {
        await setKeyInResultsCaches(context, result, query.model)
        return prepareQueryResults(query, context, result)
    }
}
