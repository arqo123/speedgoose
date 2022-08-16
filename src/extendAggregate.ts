import {Aggregate, Mongoose} from "mongoose";
import {CacheClients, SpeedGooseCacheOperationParams} from "./types/types";
import {setKeyInResultsCaches} from "./utils/cacheClientUtils";
import {prepareAggregateOperationParams} from "./utils/queryUtis";

export const addCachingToAggregate = (mongoose: Mongoose, cacheClients: CacheClients): void => {
    /** 
     * Caches given aggregation operation. 
    */
    mongoose.Aggregate.prototype.cachePipeline = function <R>(params: SpeedGooseCacheOperationParams = {}): Promise<Aggregate<R>> {
        return execAggregationWithCache<R>(this, cacheClients, params)
    }
}

const execAggregationWithCache = async <R>(
    aggregation: Aggregate<R>,
    cacheClients: CacheClients,
    params: SpeedGooseCacheOperationParams,
): Promise<Aggregate<R>> => {
    prepareAggregateOperationParams(aggregation, params)

    const cachedValue = await cacheClients.resultsCache.get(params.cacheKey) as R

    if (cachedValue) return cachedValue

    const result = await aggregation.exec() as R

    if (result) {
        await setKeyInResultsCaches(params, result, aggregation._model, cacheClients)

        return result
    }
}