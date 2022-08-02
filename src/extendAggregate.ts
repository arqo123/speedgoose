import {Aggregate, Mongoose} from "mongoose";
import {CacheClients} from "./types/types";
import {generateCacheKeyFromPipeline, setKeyInResultsCaches} from "./utils";

export const addCachingToAggregate = (mongoose: Mongoose, cacheClients: CacheClients): void => {
    mongoose.Aggregate.prototype.cachePipeline = function (ttl = 30 * 1000, customKey = null) {
        return execAggregationWithCache(this, cacheClients, ttl, customKey)
    }
}

const execAggregationWithCache = async <R>(
    aggregation: Aggregate<R>,
    cacheClients: CacheClients,
    ttl: number,
    customKey?: string
): Promise<Aggregate<R>> => {
    const key = customKey ?? generateCacheKeyFromPipeline(aggregation)
 
    const cachedValue = await cacheClients.resultsCache.get(key) as R

    if (cachedValue) return cachedValue

    const result = await aggregation.exec() as R

    if (result) {
        await setKeyInResultsCaches(key, ttl, result, aggregation._model, cacheClients)
    }

    return result
}