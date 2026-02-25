import { Aggregate, Mongoose } from 'mongoose';
import { AggregationResult, CachedResult, SpeedGooseCacheOperationContext, SpeedGooseCacheOperationParams } from './types/types';
import { getResultsFromCache, isCached, refreshTTLTimeIfNeeded, setKeyInResultsCaches } from './utils/cacheClientUtils';
import { isCachingEnabled } from './utils/commonUtils';
import { prepareAggregateOperationParams } from './utils/queryUtils';
import { singleflight } from './utils/singleflightUtils';

export const addCachingToAggregate = (mongoose: Mongoose): void => {
    /**
     * Caches given aggregation operation.
     */
    mongoose.Aggregate.prototype.cachePipeline = function <R extends unknown[] = unknown[]>(params: SpeedGooseCacheOperationParams = {}): Promise<R> {
        return isCachingEnabled() ? execAggregationWithCache<R>(this, params) : this.exec();
    };

    /**
     * Function to check if given query is cached.
     */
    mongoose.Aggregate.prototype.isCached = function <T>(context: SpeedGooseCacheOperationParams = {}): Promise<boolean> {
        prepareAggregateOperationParams(this, context);

        return isCached(context.cacheKey);
    };
};

const execAggregationWithCache = async <R extends unknown[] = unknown[]>(aggregation: Aggregate<R>, context: SpeedGooseCacheOperationContext): Promise<R> => {
    prepareAggregateOperationParams(aggregation, context);

    if (context?.ttl !== undefined && context.ttl <= 0) {
        context?.debug(`Skipping cache read/write because ttl <= 0`, context.cacheKey);
        return aggregation.exec();
    }

    context?.debug(`Reading cache for key`, context.cacheKey);
    const cachedValue = (await getResultsFromCache(context.cacheKey)) as AggregationResult;

    if (cachedValue) {
        context?.debug(`Returning cache for key`, context.cacheKey);

        refreshTTLTimeIfNeeded(context, cachedValue);
        return cachedValue as R;
    }

    context?.debug(`Key didn't exists in cache, fetching value from database`, context.cacheKey);
    return singleflight(context.cacheKey, async () => {
        const result = await aggregation.exec();
        if (result !== undefined) {
            await setKeyInResultsCaches(context, result as CachedResult, aggregation._model);
        }
        return result;
    });
};
