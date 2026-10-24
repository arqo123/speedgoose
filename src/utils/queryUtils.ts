import { Query, Aggregate, isObjectIdOrHexString } from 'mongoose';
import { MongooseCountQueries, MongooseSpecialQueries, SpeedGooseCacheOperationContext, SpeedGooseDebuggerOperations } from '../types/types';
import { generateCacheKeyFromPipeline, generateCacheKeyFromQuery, hashCacheKey } from './cacheKeyUtils';
import { getCacheStrategyInstance, getConfig } from './commonUtils';
import { getDebugger } from './debugUtils';

export const stringifyQueryParam = (queryParam: Record<string, unknown>): string =>
    Object.entries(queryParam)
        .map(([field, value]) => `${field}:${value}`)
        .sort()
        .toString();

export const stringifyPopulatedPaths = (populatedPaths: string[]): string => populatedPaths.sort().toString();

const getMultitenantValueFromQuery = <T>(query: Query<T, T>, multitenantKey: string): string | undefined => {
    const value = query.getQuery()[multitenantKey];
    // No single tenant (null/missing, array, $in, ...): tracked under the model-wide key, which every create/delete clears.
    if (value == null) return undefined;
    return typeof value === 'object' && !isObjectIdOrHexString(value) ? undefined : value;
};

// ttl <= 0 disables caching. A ttl that is not a finite number would store a result that never expires,
// and Redis only accepts whole seconds.
const normalizeTtl = (ttl: number | undefined, defaultTtl: number | undefined): number | undefined => {
    if (ttl == null) return defaultTtl;
    if (ttl <= 0) return ttl;
    return Number.isFinite(ttl) ? Math.ceil(ttl) : defaultTtl;
};

export const isLeanQuery = <T>(query: Query<T, T>): boolean => Boolean(query?._mongooseOptions.lean);

export const isCountQuery = <T>(query: Query<T, T>): boolean => Object.values(MongooseCountQueries).includes(query.op as MongooseCountQueries);

export const isDistinctQuery = <T>(query: Query<T, T>): boolean => MongooseSpecialQueries.DISTINCT === query.op;

export const prepareQueryOperationContext = <T>(query: Query<T, T>, context: SpeedGooseCacheOperationContext): void => {
    const config = getConfig();

    if (config?.multitenancyConfig?.multitenantKey) {
        context.multitenantValue = context.multitenantValue ?? getMultitenantValueFromQuery(query, config.multitenancyConfig.multitenantKey);
    }

    context.ttl = normalizeTtl(context?.ttl, config?.defaultTtl);

    if (config?.refreshTtlOnRead) {
        context.refreshTtlOnRead = context?.refreshTtlOnRead ?? config.refreshTtlOnRead;
    }

    context.cacheKey = context?.cacheKey ?? hashCacheKey(generateCacheKeyFromQuery(query));

    context.debug = getDebugger(query.model.modelName, SpeedGooseDebuggerOperations.CACHE_QUERY);
};

export const prepareAggregateOperationParams = <R>(aggregation: Aggregate<R>, context: SpeedGooseCacheOperationContext): void => {
    const config = getConfig();

    context.ttl = normalizeTtl(context?.ttl, config?.defaultTtl);

    if (config?.refreshTtlOnRead) {
        context.refreshTtlOnRead = context?.refreshTtlOnRead ?? config.refreshTtlOnRead;
    }

    context.cacheKey = context?.cacheKey ?? hashCacheKey(generateCacheKeyFromPipeline(aggregation));

    context.debug = getDebugger(aggregation._model.modelName, SpeedGooseDebuggerOperations.CACHE_PIPELINE);
};

export const shouldHydrateResult = <T>(query: Query<T, T>): boolean => {
    if (!getCacheStrategyInstance().isHydrationEnabled()) {
        return false;
    }

    return !isLeanQuery(query) && !isCountQuery(query) && !isDistinctQuery(query);
};
