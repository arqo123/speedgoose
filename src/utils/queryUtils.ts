import {Query, Aggregate} from "mongoose";
import {MongooseCountQueries, SpeedGooseCacheOperationContext, SpeedGooseCacheOperationParams, SpeedGooseDebuggerOperations} from "../types/types";
import {generateCacheKeyFromPipeline, generateCacheKeyFromQuery} from "./cacheKeyUtils";
import {getConfig} from "./commonUtils"
import {getDebugger} from "./debugUtils";

export const stringifyQueryParam = (queryParam: Record<string, unknown>): string =>
    Object.entries(queryParam).map(([field, value]) => `${field}:${value}`).sort().toString()

export const stringifyPopulatedPaths = (populatedPaths: string[]): string =>
    populatedPaths.sort().toString()

const getMultitenantValueFromQuery = <T>(query: Query<T, T>, multitenantKey: string): string =>
    query.getQuery()[multitenantKey]


export const isLeanQuery = <T>(query: Query<T, T>): boolean => query?._mongooseOptions.lean

export const isCountQuery = <T>(query: Query<T, T>): boolean => Object.values(MongooseCountQueries).includes(query.op as MongooseCountQueries)

export const prepareQueryOperationContext = <T>(query: Query<T, T>, context: SpeedGooseCacheOperationContext): void => {
    const config = getConfig()

    if (config?.multitenancyConfig?.multitenantKey) {
        context.multitenantValue = context.multitenantValue ?? getMultitenantValueFromQuery(query, config.multitenancyConfig.multitenantKey)
    }

    if (config?.defaultTtl) {
        context.ttl = context?.ttl ?? config.defaultTtl
    }

    context.cacheKey = context?.cacheKey ?? generateCacheKeyFromQuery(query)

    context.debug = getDebugger(query.model.modelName, SpeedGooseDebuggerOperations.CACHE_QUERY) 
}

export const prepareAggregateOperationParams = <R>(aggregation: Aggregate<R>, context: SpeedGooseCacheOperationContext): void => {
    const config = getConfig()

    if (config?.defaultTtl) {
        context.ttl = context?.ttl ?? config.defaultTtl
    }

    context.cacheKey = context?.cacheKey ?? generateCacheKeyFromPipeline(aggregation)

    context.debug = getDebugger(aggregation._model.modelName, SpeedGooseDebuggerOperations.CACHE_PIPELINE)
}
