
import {Mongoose, Document, DocumentQuery, Query} from "mongoose"
import {setKeyInHydrationCaches, setKeyInResultsCaches} from "./cacheClientUtils"
import {CacheClients, CachedDocument, CachedResult, SpeedGooseCacheOperationParams} from "./types/types"
import {generateCacheKeyForSingleDocument, isCountQuery, isLeanQuery, prepareQueryOperationParams} from "./utils"

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

const hydrateResults = <T extends CachedResult>(
    query: Query<T, T>,
    params: SpeedGooseCacheOperationParams,
    result: CachedDocument,
    cacheClients: CacheClients
): Promise<CachedDocument | CachedDocument[]> =>
    Array.isArray(result) ? getHydratedDocuments(query, params, result, cacheClients) : getHydratedDocument(query, params, result, cacheClients);

const getHydratedDocuments = <T>(query: Query<T, T>, params: SpeedGooseCacheOperationParams, results: Document<T>[], cacheClients: CacheClients) =>
    Promise.all(results.map(record => getHydratedDocument(query, params, record, cacheClients)))

const getHydratedDocument = async <T>(query: Query<T, T>, params: SpeedGooseCacheOperationParams, result: Document, cacheClients: CacheClients): Promise<Document<T>> => {
    const cacheKey = generateCacheKeyForSingleDocument(query, result)
    const cachedValue = await cacheClients.singleRecordsCache.get(cacheKey)

    if (cachedValue) return cachedValue

    const hydratedDocument = hydrateDocument(query, result)

    await setKeyInHydrationCaches(cacheKey, hydratedDocument, params, cacheClients)

    return hydratedDocument
}

const hydrateDocument = <T>(query: Query<T, T>, record: Document<T>): Document<T> => query.model.hydrate(record)

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
