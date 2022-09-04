import {CachedResult} from "../types/types";

export abstract class CommonCacheStrategyAbstract {
    public abstract getValueFromCache(namespace: string, key: string): Promise<CachedResult>;
    public abstract addValueToCache<T extends CachedResult>(namespace: string, key: string, value: T, ttl?: number): Promise<void>;
    public abstract addValueToCacheSet<T extends string | number>(namespace: string, value: T): Promise<void>;
    public abstract addValueToManyCachedSets<T extends string | number>(namespaces: string[], value: T): Promise<void>;
    public abstract removeKeyForCache(namespace: string, key: string): Promise<void>
    public abstract clearResultsCacheWithSet(namespace: string): Promise<void>
}

export interface CommonCacheStrategyStaticMethods {
    register(): Promise<void>
}