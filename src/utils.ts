import mongoose, {Model, Query, Document, Aggregate} from "mongoose";
import {CacheClients, CachedDocument, CachedResult} from "./types/types";

export const makeArrayUnique = <T extends any>(array: T[]) => [...new Set(array)]

export const isLeanQuery = <T>(query: Query<T, T>): boolean => query?._mongooseOptions.lean

export const isCountQuery = <T>(query: Query<T, T>): boolean => ['count', 'countDocuments', 'estimatedDocumentCount'].includes(query.op)

export const objectSerializer = <T>(record: T): T => record
export const objectDeserializer = <T>(record: T): T => record

export const generateCacheKeyFromQuery = <T>(query: Query<T, T>): string => JSON.stringify(
    {
        ...query.getQuery(),
        collection: query.mongooseCollection.name,
        op: query.op,
        options: query.getOptions()
    }
)

export const generateCacheKeyFromPipeline = <R>(aggregation: Aggregate<R>): string => JSON.stringify(
    {
        pipeline: aggregation.pipeline(),
        collection: aggregation._model.collection.name,
    }
)

const stringifyProjectionFields = (queryProjection: Record<string, number>): string =>
    Object.entries(queryProjection).map(([field, projection]) => `${field}:${projection}`).sort().toString()

export const generateCacheKeyForSingleDocument = <T extends CachedDocument>(query: Query<T, T>, record: Document<T>): string => {
    if (!query.selected) {
        return String(record._id)
    }

    const projectionFields = stringifyProjectionFields(query?.getOptions()?.projection ?? {})

    return `${record._id}_${projectionFields}`
}
 
//@ts-expect-error
export const getMongooseModelName = <T>(record: Document<T>): string => record.constructor.modelName

export const getMongooseModelFromDocument = <T>(record: Document): Model<T> => mongoose.models[getMongooseModelName(record)]

export const getMongooseModelForName = <T>(mongooseModelName: string): Model<T> => mongoose.models[mongooseModelName]

export const isObjectWithId = (value: unknown): boolean => {
    return value && typeof value === 'object' && value.hasOwnProperty('_id')
};

const isArrayOfObjectsWithIds = (value: unknown): boolean => {
    if (Array.isArray(value)) {
        return value[0] && typeof value[0] === 'object' && value[0].hasOwnProperty('_id')
    } return false
};

export const isResultWithIds = (result: unknown): boolean => isArrayOfObjectsWithIds(result) || isObjectWithId(result)

export const setKeyInResultsCaches = async <T extends CachedResult, M>(key: string, ttl: number, result: T, model: Model<M>, cacheClients: CacheClients): Promise<void> => {
    await setKeyInResultsCache(result, key, ttl, cacheClients)
    await setKeyInModelCache(model, key, ttl, cacheClients)

    if (isResultWithIds(result)) {
        await setKeyInRecordsCache(result as CachedDocument, key, ttl, cacheClients)
    }
}

export const setKeyInHydrationCaches = async <T>(key: string, document: Document<T>, ttl: number, cacheClients: CacheClients): Promise<void> => {
    await setKeyInSingleRecordsCache(document, key, ttl, cacheClients)
    await setKeyInSingleRecordsKeyCache(document, key, ttl, cacheClients)
}

const setKeyInSingleRecordsCache = async <T>(document: Document<T>, key: string, ttl: number, cacheClients: CacheClients): Promise<void> => {
    await cacheClients.singleRecordsCache.set(key, document, ttl * 1000)
}

const setKeyInSingleRecordsKeyCache = async <T>(document: Document<T>, key: string, ttl: number, cacheClients: CacheClients): Promise<void> => {
    const existingCacheEntry = await cacheClients.modelsKeyCache.get(String(document._id)) ?? []
    await cacheClients.modelsKeyCache.set(String(document._id), makeArrayUnique([...existingCacheEntry, key]), ttl * 1000)
}

const setKeyInResultsCache = async <T extends CachedResult>(results: T, key: string, ttl: number, cacheClients: CacheClients): Promise<void> => {
    await cacheClients.resultsCache.set(key, results, ttl * 1000)
}

const setKeyInModelCache = async <T>(model: Model<T>, key: string, ttl: number, cacheClients: CacheClients): Promise<void> => {
    const existingCacheEntry = await cacheClients.modelsKeyCache.get(model.modelName) ?? []
    await cacheClients.modelsKeyCache.set(model.modelName, makeArrayUnique([...existingCacheEntry, key]), ttl * 1000)
}

const setKeyInRecordsCache = async (result: CachedDocument, key: string, ttl: number, cacheClients: CacheClients): Promise<void> => {
    const resultsIds = Array.isArray(result) ? result.map(record => record._id) : [result._id]

    for (const id of resultsIds) {
        const existingCacheEntry = await cacheClients.recordsKeyCache.get(String(id)) ?? []
        await cacheClients.recordsKeyCache.set(String(id), makeArrayUnique([...existingCacheEntry, key]), ttl * 1000)
    }
}
