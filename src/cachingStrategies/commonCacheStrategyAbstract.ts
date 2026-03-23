import { CachedResult, CacheNamespaces } from '../types/types';

/**
 * Extracts recordId from a document cache key.
 * Key format: doc:{modelName}:{recordId}[:select:{selectKey}]
 * Handles recordIds containing colons (e.g. "tenant:123").
 */
export const extractRecordIdFromDocKey = (key: string): string | null => {
    const prefix = CacheNamespaces.DOCUMENTS + ':';
    if (!key.startsWith(prefix)) return null;
    const rest = key.substring(prefix.length); // 'ModelName:recordId[:select:selectKey]'
    const modelEnd = rest.indexOf(':');
    if (modelEnd < 0) return null;
    const afterModel = rest.substring(modelEnd + 1); // 'recordId[:select:selectKey]'
    const selectIdx = afterModel.indexOf(':select:');
    return selectIdx >= 0 ? afterModel.substring(0, selectIdx) : afterModel;
};

export abstract class CommonCacheStrategyAbstract {
    public abstract getValueFromCache(namespace: string, key: string): Promise<CachedResult | null>;
    public abstract isValueCached(namespace: string, key: string): Promise<boolean>;
    public abstract getValuesFromCachedSet(namespace: string): Promise<string[]>;
    public abstract addValueToCache<T>(namespace: string, key: string, value: CachedResult<T>, ttl?: number): Promise<void>;
    public abstract addValueToCacheSet<T extends string | number>(namespace: string, value: T, setsTtl?: number, maxSetCardinality?: number): Promise<void>;
    public abstract addValueToManyCachedSets<T extends string | number>(namespaces: string[], value: T, setsTtl?: number, maxSetCardinality?: number): Promise<void>;
    public abstract removeKeyForCache(namespace: string, key: string): Promise<void>;
    public abstract clearResultsCacheWithSet(namespace: string): Promise<void>;
    public abstract refreshTTLForCachedResult(key: string, ttl: number, value: CachedResult): void;

    public abstract getDocuments<T>(keys: string[]): Promise<Map<string, CachedResult<T>>>;
    public abstract setDocuments<T>(documents: Map<string, CachedResult<T>>, ttl: number): Promise<void>;
    public abstract addParentToChildRelationship(childIdentifier: string, parentIdentifier: string, setsTtl?: number, maxSetCardinality?: number): Promise<void>;
    public abstract addManyParentToChildRelationships(relationships: Array<{ childIdentifier: string; parentIdentifier: string }>, setsTtl?: number, maxSetCardinality?: number): Promise<void>;
    public abstract getParentsOfChild(childIdentifier: string): Promise<string[]>;
    public abstract removeChildRelationships(childIdentifier: string): Promise<void>;
    public abstract clearDocumentsCache(namespace: string): Promise<void>;
    public abstract clearRelationshipsForModel(parentIdentifier: string): Promise<void>;

    public isHydrationEnabled(): boolean {
        return true;
    }
}

export interface CommonCacheStrategyStaticMethods {
    register(): Promise<void>;
}
