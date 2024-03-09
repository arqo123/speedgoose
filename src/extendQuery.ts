import { Mongoose, Query, Document } from 'mongoose';
import { CachedDocument, CachedResult, SpeedGooseCacheOperationContext, SpeedGooseCacheOperationParams } from './types/types';
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
};

const prepareQueryResults = async <T>(query: Query<T, T>, context: SpeedGooseCacheOperationContext, result: CachedResult<T>): Promise<CachedResult<T> | CachedResult<T>[]> => {
    return shouldHydrateResult(query) ? await hydrateResults(query, context, result as CachedDocument<T>) : result;
};

const execQueryWithCache = async <T>(query: Query<T, T>, context: SpeedGooseCacheOperationContext): Promise<Query<CachedResult<T> | CachedResult<T>[], Document<T>>> => {
    prepareQueryOperationContext(query, context);

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
