import {Aggregate, Mongoose} from "mongoose";
import {CacheNamespaces, SpeedGooseCacheOperationContext, SpeedGooseCacheOperationParams} from "./types/types";
import {setKeyInResultsCaches} from "./utils/cacheClientUtils";
import {prepareAggregateOperationParams} from "./utils/queryUtils";
import {getValueFromCache} from "./utils/redisUtils";

export const addCachingToAggregate = (mongoose: Mongoose): void => {
    /** 
     * Caches given aggregation operation. 
    */
    mongoose.Aggregate.prototype.cachePipeline = function <R>(params: SpeedGooseCacheOperationParams = {}): Promise<Aggregate<R>> {
        return execAggregationWithCache<R>(this, params)
    }
}

const execAggregationWithCache = async <R>(
    aggregation: Aggregate<R>,
    context: SpeedGooseCacheOperationContext,
): Promise<Aggregate<R>> => {
    prepareAggregateOperationParams(aggregation, context)
    context?.debug(`Reading cache for key`, context.cacheKey)
    
    const cachedValue = await getValueFromCache(CacheNamespaces.RESULTS_NAMESPACE, context.cacheKey) as R

    if (cachedValue) {
        context?.debug(`Returning cache for key`, context.cacheKey)
        return cachedValue
    }
    
    context?.debug(`Key didn't exists in cache, retreaving value from database`, context.cacheKey)
    const result = await aggregation.exec() as R

    if (result) {
        await setKeyInResultsCaches(context, result, aggregation._model)

        return result
    }
}