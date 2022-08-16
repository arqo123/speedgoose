import {Query, Aggregate} from "mongoose";
import {MongooseCountQueries, SpeedGooseCacheOperationParams} from "../types/types";
import {generateCacheKeyFromPipeline, generateCacheKeyFromQuery} from "./cacheKeyUtils";
import {getConfig} from "./commonUtils"

export const stringifyQueryParam = (queryParam: Record<string, unknown>): string =>
    Object.entries(queryParam).map(([field, value]) => `${field}:${value}`).sort().toString()

export const stringifyPopulatedPaths = (populatedPaths: string[]): string =>
    populatedPaths.sort().toString()

const getMultitenantValueFromQuery = <T>(query: Query<T, T>, multitenantKey: string): string =>
    query.getQuery()[multitenantKey]


export const isLeanQuery = <T>(query: Query<T, T>): boolean => query?._mongooseOptions.lean

export const isCountQuery = <T>(query: Query<T, T>): boolean => Object.values(MongooseCountQueries).includes(query.op as MongooseCountQueries)

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
