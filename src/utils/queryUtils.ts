import { Query, Aggregate } from 'mongoose';
import { MongooseCountQueries, MongooseSpecialQueries, SpeedGooseCacheOperationContext, SpeedGooseDebuggerOperations } from '../types/types';
import { generateCacheKeyFromPipeline, generateCacheKeyFromQuery } from './cacheKeyUtils';
import { getCacheStrategyInstance, getConfig } from './commonUtils';
import { getDebugger } from './debugUtils';

export const stringifyQueryParam = (queryParam: Record<string, unknown>): string =>
    Object.entries(queryParam)
        .map(([field, value]) => `${field}:${value}`)
        .sort()
        .toString();

export const stringifyPopulatedPaths = (populatedPaths: string[]): string => populatedPaths.sort().toString();

const getMultitenantValueFromQuery = <T>(query: Query<T, T>, multitenantKey: string): string => query.getQuery()[multitenantKey];

export const isLeanQuery = <T>(query: Query<T, T>): boolean => Boolean(query?._mongooseOptions.lean);

export const isCountQuery = <T>(query: Query<T, T>): boolean => Object.values(MongooseCountQueries).includes(query.op as MongooseCountQueries);

export const isDistinctQuery = <T>(query: Query<T, T>): boolean => MongooseSpecialQueries.DISTINCT === query.op;

export const prepareQueryOperationContext = <T>(query: Query<T, T>, context: SpeedGooseCacheOperationContext): void => {
    const config = getConfig();

    if (config?.multitenancyConfig?.multitenantKey) {
        context.multitenantValue = context.multitenantValue ?? getMultitenantValueFromQuery(query, config.multitenancyConfig.multitenantKey);
    }

    if (config?.defaultTtl) {
        context.ttl = context?.ttl ?? config.defaultTtl;
    }
 
    if (config?.refreshTtlOnRead) {
        context.refreshTtlOnRead = context?.refreshTtlOnRead ?? config.refreshTtlOnRead;
    }

    context.cacheKey = context?.cacheKey ?? generateCacheKeyFromQuery(query);

    context.debug = getDebugger(query.model.modelName, SpeedGooseDebuggerOperations.CACHE_QUERY);
};

export const prepareAggregateOperationParams = <R>(aggregation: Aggregate<R[], R>, context: SpeedGooseCacheOperationContext): void => {
    const config = getConfig();

    if (config?.defaultTtl) {
        context.ttl = context?.ttl ?? config.defaultTtl;
    }

    if (config?.refreshTtlOnRead) {
        context.refreshTtlOnRead = context?.refreshTtlOnRead ?? config.refreshTtlOnRead;
    }

    context.cacheKey = context?.cacheKey ?? generateCacheKeyFromPipeline(aggregation);

    context.debug = getDebugger(aggregation._model.modelName, SpeedGooseDebuggerOperations.CACHE_PIPELINE);
};

export const shouldHydrateResult = <T>(query: Query<T, T>): boolean => {
    if (!getCacheStrategyInstance().isHydrationEnabled()) {
        return false;
    }

    return !isLeanQuery(query) && !isCountQuery(query) && !isDistinctQuery(query);
};
