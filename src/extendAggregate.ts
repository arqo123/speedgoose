import {Aggregate, Mongoose} from "mongoose";
import {CacheNamespaces, SpeedGooseCacheOperationParams} from "./types/types";
import {setKeyInResultsCaches} from "./utils/cacheClientUtils";
import {prepareAggregateOperationParams} from "./utils/queryUtis";
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
    params: SpeedGooseCacheOperationParams,
): Promise<Aggregate<R>> => {
    prepareAggregateOperationParams(aggregation, params)

    const cachedValue = await getValueFromCache(CacheNamespaces.RESULTS_NAMESPACE, params.cacheKey) as R

    if (cachedValue) return cachedValue

    const result = await aggregation.exec() as R

    if (result) {
        await setKeyInResultsCaches(params, result, aggregation._model)

        return result
    }
}