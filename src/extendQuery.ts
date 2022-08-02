
import {Mongoose, Document, DocumentQuery, Query} from "mongoose"
import {CacheClients, CachedDocument, CachedResult} from "./types/types"
import {generateCacheKeyForSingleDocument, generateCacheKeyFromQuery, isCountQuery, isLeanQuery, setKeyInHydrationCaches, setKeyInResultsCaches} from "./utils"

export const addCachingToQuery = (mongoose: Mongoose, cacheClients: CacheClients): void => {
    mongoose.Query.prototype.cacheQuery = function (ttl = 60 * 1000, customKey = null) {
        return execQueryWithCache(this, cacheClients, ttl, customKey)
    }
}

const prepareQueryResults = async <T extends CachedResult>(query: Query<T, T>, result: CachedResult, cacheClients: CacheClients): Promise<CachedResult | CachedResult[]> => {
    return isLeanQuery(query) || isCountQuery(query) ? result : await hydrateResults(query, result as CachedDocument, cacheClients)
}

const hydrateResults = <T extends CachedResult>(query: Query<T, T>, result: CachedDocument, cacheClients: CacheClients): Promise<CachedDocument | CachedDocument[]> =>
    Array.isArray(result) ? getHydratedDocuments(query, result, cacheClients) : getHydratedDocument(query, result, cacheClients);

const getHydratedDocuments = <T>(query: Query<T, T>, results: Document<T>[], cacheClients: CacheClients) => Promise.all(results.map(record => getHydratedDocument(query, record, cacheClients)))

const getHydratedDocument = async <T>(query: Query<T, T>, result: Document, cacheClients: CacheClients): Promise<Document<T>> => {
    const cacheKey = generateCacheKeyForSingleDocument(query, result)
    const cachedValue = await cacheClients.singleRecordsCache.get(cacheKey)
 
    if (cachedValue) return cachedValue

    const hydratedDocument = hydrateDocument(query, result)

    await setKeyInHydrationCaches(cacheKey, hydratedDocument, 60, cacheClients)

    return hydratedDocument
}

const hydrateDocument = <T>(query: Query<T, T>, record: Document<T>): Document<T> => query.model.hydrate(record)

const execQueryWithCache = async <T extends CachedResult>(
    query: Query<T, T>,
    cacheClients: CacheClients,
    ttl: number,
    customKey?: string
): Promise<DocumentQuery<CachedResult | CachedResult[], any>> => {
    const key = customKey ?? generateCacheKeyFromQuery(query)

    const cachedValue = await cacheClients.resultsCache.get(key)

    if (cachedValue) return prepareQueryResults(query, cachedValue, cacheClients)

    const result = await query.exec()

    if (result) {
        await setKeyInResultsCaches(key, ttl, result, query.model, cacheClients)
    }

    return prepareQueryResults(query, result, cacheClients)
}
