import { Aggregate, Mongoose } from 'mongoose';
import { AggregationResult, CachedResult, SpeedGooseCacheOperationContext, SpeedGooseCacheOperationParams } from './types/types';
import { getResultsFromCache, refreshTTLTimeIfNeeded, setKeyInResultsCaches } from './utils/cacheClientUtils';
import { isCachingEnabled } from './utils/commonUtils';
import { prepareAggregateOperationParams } from './utils/queryUtils';

export const addCachingToAggregate = (mongoose: Mongoose): void => {
    /**
     * Caches given aggregation operation.
     */
    mongoose.Aggregate.prototype.cachePipeline = function <R>(params: SpeedGooseCacheOperationParams = {}): Promise<Aggregate<R[], R>> {
        return isCachingEnabled() ? execAggregationWithCache<R>(this, params) : this.exec();
    };
};

const execAggregationWithCache = async <R>(aggregation: Aggregate<R[], R>, context: SpeedGooseCacheOperationContext): Promise<Aggregate<R[], R>> => {
    prepareAggregateOperationParams(aggregation, context);

    context?.debug(`Reading cache for key`, context.cacheKey);
    const cachedValue = (await getResultsFromCache(context.cacheKey)) as AggregationResult;

    if (cachedValue) {
        context?.debug(`Returning cache for key`, context.cacheKey);

        refreshTTLTimeIfNeeded(context, cachedValue);
        return cachedValue as Aggregate<R[], R>;
    }

    context?.debug(`Key didn't exists in cache, fetching value from database`, context.cacheKey);
    const result = (await aggregation.exec());

    if (result) {
        await setKeyInResultsCaches(context, result as CachedResult<R>, aggregation._model);

        return result as R[];
    }
};
