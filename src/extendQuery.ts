import {Mongoose, Query, Document} from "mongoose"
import {CachedLeanDocument, CachedResult, SpeedGooseCacheOperationContext, SpeedGooseCacheOperationParams} from "./types/types"
import {getResultsFromCache, setKeyInResultsCaches} from "./utils/cacheClientUtils"
import {hydrateResults} from "./utils/hydrationUtils"
import {isCountQuery, isLeanQuery, prepareQueryOperationContext} from "./utils/queryUtils"

export const addCachingToQuery = (mongoose: Mongoose): void => {
    /** 
     * Caches given query based operation. 
    */
    mongoose.Query.prototype.cacheQuery = function <T>(params: SpeedGooseCacheOperationParams = {}): Promise<Query<CachedResult<T> | CachedResult<T>[], Document<T>>> {
        return execQueryWithCache<T>(this, params)
    }
}

const prepareQueryResults = async <T>(
    query: Query<T, T>,
    context: SpeedGooseCacheOperationContext,
    result: CachedResult<T>,
): Promise<CachedResult<T> | CachedResult<T>[]> => {
    return isLeanQuery(query) || isCountQuery(query) ? result : await hydrateResults(query, context, result as CachedLeanDocument<T>)
}

const execQueryWithCache = async <T>(
    query: Query<T, T>,
    context: SpeedGooseCacheOperationContext
): Promise<Query<CachedResult<T> | CachedResult<T>[], Document<T>>> => {
    prepareQueryOperationContext(query, context)

    context?.debug(`Reading cache for key`, context.cacheKey)
    const cachedValue = await getResultsFromCache(context.cacheKey) as CachedResult<T>

    if (cachedValue) {
        context?.debug(`Returning cache for key`, context.cacheKey)
        return prepareQueryResults(query, context, cachedValue)
    }

    context?.debug(`Key didn't exists in cache, retreaving value from database`, context.cacheKey)
    const result = await query.exec() as CachedResult<T>

    if (result) {
        await setKeyInResultsCaches(context, result, query.model)
        return prepareQueryResults(query, context, result)
    }
}
