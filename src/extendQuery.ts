import { Mongoose, Query, Document } from 'mongoose';
import {
    CachedDocument,
    CachedResult,
    SpeedGooseCacheOperationContext,
    SpeedGooseCacheOperationParams,
    SpeedGoosePopulateOptions
} from './types/types';
import { getResultsFromCache, isCached, refreshTTLTimeIfNeeded, setKeyInResultsCaches } from './utils/cacheClientUtils';
import { isCachingEnabled } from './utils/commonUtils';
import { hydrateResults } from './utils/hydrationUtils';
import { prepareQueryOperationContext, shouldHydrateResult } from './utils/queryUtils';

export const addCachingToQuery = (mongoose: Mongoose): void => {
    /**
     * Caches given query based operation.
     */
    mongoose.Query.prototype.cacheQuery = function <T>(params: SpeedGooseCacheOperationParams = {}): Promise<Query<CachedResult<T> | CachedResult<T>[], Document<T>>> {
        return isCachingEnabled() ? execQueryWithCache<T>(this, params) : this.exec();
    };
    
    /**
     * Function to check if given query is cached.
     */
    mongoose.Query.prototype.isCached = function <T>(context: SpeedGooseCacheOperationParams = {}): Promise<boolean> {
        prepareQueryOperationContext(this, context);

        return isCached(context.cacheKey)
    };

    /**
     * Function to add populate options for cached population
     */
    mongoose.Query.prototype.cachePopulate = function (options: string | SpeedGoosePopulateOptions | SpeedGoosePopulateOptions[]) {
        if (!this._mongooseOptions.speedGoosePopulate) {
            this._mongooseOptions.speedGoosePopulate = [];
        }

        const opts = normalizePopulateOptions(options);
        this._mongooseOptions.speedGoosePopulate.push(...opts);
        return this;
    };
};

const normalizePopulateOptions = (options: string | SpeedGoosePopulateOptions | SpeedGoosePopulateOptions[]): SpeedGoosePopulateOptions[] => {
    if (typeof options === 'string') {
        return options.split(' ').filter(Boolean).map(path => ({ path }));
    }

    return Array.isArray(options) ? options : [options];
};

const prepareQueryResults = async <T>(query: Query<T, T>, context: SpeedGooseCacheOperationContext, result: CachedResult<T>): Promise<CachedResult<T> | CachedResult<T>[]> => {
    return shouldHydrateResult(query) ? await hydrateResults(query, context, result as CachedDocument<T>) : result;
};

const execQueryWithCache = async <T>(query: Query<T, T>, context: SpeedGooseCacheOperationContext): Promise<Query<CachedResult<T> | CachedResult<T>[], Document<T>>> => {
    prepareQueryOperationContext(query, context);

    if (context?.ttl !== undefined && context.ttl <= 0) {
        context?.debug(`Skipping cache read/write because ttl <= 0`, context.cacheKey);
        return query.exec();
    }

    context?.debug(`Reading cache for key`, context.cacheKey);
    const cachedValue = (await getResultsFromCache(context.cacheKey)) as CachedResult<T>;

    if (cachedValue) {
        context?.debug(`Returning cache for key`, context.cacheKey);
        refreshTTLTimeIfNeeded(context, cachedValue);
        return prepareQueryResults(query, context, cachedValue);
    }

    context?.debug(`Key didn't exists in cache, fetching value from database`, context.cacheKey);
    const result = (await query.exec()) as CachedResult<T>;

    if (result !== undefined) {
        await setKeyInResultsCaches(context, result, query.model);
        return prepareQueryResults(query, context, result);
    }
};
