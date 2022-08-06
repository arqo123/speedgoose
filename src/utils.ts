import {Mongoose} from "mongoose";
import {Model, Query, Document, Aggregate} from "mongoose";
import Container from "typedi";
import {CachedDocument, GlobalDiContainerRegistryNames, SpeedGooseCacheOperationParams, SpeedGooseConfig} from "./types/types";

const stringifyProjectionFields = (queryProjection: Record<string, number>): string =>
    Object.entries(queryProjection).map(([field, projection]) => `${field}:${projection}`).sort().toString()

const isArrayOfObjectsWithIds = (value: unknown): boolean => {
    if (Array.isArray(value)) {
        return value[0] && typeof value[0] === 'object' && value[0].hasOwnProperty('_id')
    } return false
};

const getMultitenantValueFromQuery = <T>(query: Query<T, T>, multitenantKey: string): string =>
    query.getQuery()[multitenantKey]

export const prepareQueryOperationParams = <T>(query: Query<T, T>, params: SpeedGooseCacheOperationParams): void => {
    const config = getConfig()

    if (config?.multitenancyConfig?.multitenantKey) {
        params.multitenantValue = params.multitenantValue ?? getMultitenantValueFromQuery(query, config.multitenancyConfig.multitenantKey)
    }

    if (config?.defaultTtl) {
        params.ttl = params?.ttl ?? config.defaultTtl
    }

    params.cacheKey = params?.cacheKey ?? generateCacheKeyFromQuery(query)
}

export const prepareAggregateOperationParams = <R>(aggregation: Aggregate<R>, params: SpeedGooseCacheOperationParams): void => {
    const config = getConfig()

    if (config?.defaultTtl) {
        params.ttl = params?.ttl ?? config.defaultTtl
    }

    params.cacheKey = params?.cacheKey ?? generateCacheKeyFromPipeline(aggregation)
}

export const getConfig = (): SpeedGooseConfig =>
    Container.get<SpeedGooseConfig>(GlobalDiContainerRegistryNames.SPEEDGOOSE_CONFIG_GLOBAL_ACCESS)

export const getMongooseInstance = (): Mongoose =>
    Container.get<Mongoose>(GlobalDiContainerRegistryNames.MONGOOSE_GLOBAL_ACCESS)

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

export const generateCacheKeyForSingleDocument = <T extends CachedDocument>(query: Query<T, T>, record: Document<T>): string => {
    if (!query.selected) {
        return String(record._id)
    }

    const projectionFields = stringifyProjectionFields(query?.getOptions()?.projection ?? {})

    return `${record._id}_${projectionFields}`
}

export const generateCacheKeyForModelName = <T>(model: Model<T>, multitenantValue: string = ''): string =>
    `${model.modelName}_${String(multitenantValue)}`

export const generateCacheKeyForRecordAndModelName = <T>(record: Document<T>, modelName: string): string => {
    const config = getConfig()
    const multitenantKey = config?.multitenancyConfig?.multitenantKey

    return multitenantKey ? `${modelName}_${String(record[multitenantKey])})` : modelName
}

//@ts-expect-error
export const getMongooseModelName = <T>(record: Document<T>): string => record.constructor.modelName

export const getMongooseModelFromDocument = <T>(record: Document): Model<T> => getMongooseInstance().models[getMongooseModelName(record)]

export const getMongooseModelForName = <T>(mongooseModelName: string): Model<T> => getMongooseInstance().models[mongooseModelName]

export const isObjectWithId = (value: unknown): boolean => {
    return value && typeof value === 'object' && value.hasOwnProperty('_id')
};

export const isResultWithIds = (result: unknown): boolean => isArrayOfObjectsWithIds(result) || isObjectWithId(result)
