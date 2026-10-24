import Keyv from 'keyv';
import Container from 'typedi';
import { staticImplements } from '../types/decorators';
import { CachedResult, CacheNamespaces, GlobalDiContainerRegistryNames } from '../types/types';
import { createInMemoryCacheClientWithNamespace, getMaxSetCardinality, getSetsTtlFor } from '../utils/cacheClientUtils';
import { extendStoredTtl, getExtendedTtlMs } from '../utils/expiringMap';
import { CommonCacheStrategyAbstract, CommonCacheStrategyStaticMethods, extractRecordIdFromDocKey } from './commonCacheStrategyAbstract';

// Members checked for an expired value on every write, as in the Redis strategy.
const EXPIRED_MEMBERS_SAMPLE_SIZE = 4;

@staticImplements<CommonCacheStrategyStaticMethods>()
export class InMemoryStrategy extends CommonCacheStrategyAbstract {
    private resultsCacheClient: Keyv<CachedResult<unknown>>;
    private recordResultsSetsClient: Keyv<Set<string>>;
    private documentsCacheClient: Keyv<CachedResult<unknown>>;
    private relationsCacheClient: Keyv<Set<string>>;
    private keyLocks = new Map<string, Promise<void>>();

    private async withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
        while (this.keyLocks.has(key)) {
            await this.keyLocks.get(key);
        }
        let resolve: () => void;
        const lock = new Promise<void>(r => {
            resolve = r;
        });
        this.keyLocks.set(key, lock);
        try {
            return await fn();
        } finally {
            this.keyLocks.delete(key);
            resolve!();
        }
    }

    public static async register(): Promise<void> {
        const strategy = new InMemoryStrategy();
        await strategy.init();

        Container.set<InMemoryStrategy>(GlobalDiContainerRegistryNames.CACHE_CLIENT_GLOBAL_ACCESS, strategy);
    }

    public async getValueFromCache(namespace: string, key: string): Promise<CachedResult | null> {
        const keyWithNamespace = `${namespace}:${key}`;
        const result = await this.resultsCacheClient.get(keyWithNamespace);

        return (result ?? null) as CachedResult | null;
    }

    public async isValueCached(namespace: string, key: string): Promise<boolean> {
        // The ExpiringMap store answers `has` for expired entries with false.
        const keyWithNamespace = `${namespace}:${key}`;

        return this.resultsCacheClient.has(keyWithNamespace);
    }

    public async addValueToCache<T>(namespace: string, key: string, value: CachedResult<T>, ttl?: number): Promise<void> {
        const keyWithNamespace = `${namespace}:${key}`;

        await this.resultsCacheClient.set(keyWithNamespace, value, ttl * 1000);
    }

    public async addValueToCacheSet<T extends string | number>(namespace: string, value: T, setsTtl?: number, maxSetCardinality?: number): Promise<void> {
        await this.addToTrackingSet(namespace, String(value), this.resultsCacheClient, member => `${CacheNamespaces.RESULTS_NAMESPACE}:${member}`, setsTtl, maxSetCardinality);
    }

    /**
     * Same rules as the Redis script: members whose value (`valueKey(member)` in `valuesClient`) has expired
     * are dropped, a full set evicts its oldest members together with their values, and the set TTL is only extended.
     */
    private async addToTrackingSet(namespace: string, value: string, valuesClient: Keyv<CachedResult<unknown>>, valueKey: (member: string) => string, setsTtl?: number, maxSetCardinality?: number): Promise<void> {
        await this.withKeyLock(`cacheSet:${namespace}`, async () => {
            const members = (await this.recordResultsSetsClient.get(namespace)) ?? new Set<string>();

            // Insertion order: the oldest members are the most likely to be dead.
            let checked = 0;
            for (const member of members) {
                if (checked++ >= EXPIRED_MEMBERS_SAMPLE_SIZE) break;
                if (!(await valuesClient.has(valueKey(member)))) members.delete(member);
            }

            if (maxSetCardinality > 0 && !members.has(value)) {
                for (const member of members) {
                    if (members.size < maxSetCardinality) break;
                    members.delete(member);
                    await valuesClient.delete(valueKey(member));
                }
            }

            members.add(value);
            await this.recordResultsSetsClient.set(namespace, members, getExtendedTtlMs(this.recordResultsSetsClient, namespace, setsTtl));
        });
    }

    public async addValueToManyCachedSets<T extends string | number>(namespaces: string[], value: T, setsTtl?: number, maxSetCardinality?: number): Promise<void> {
        for (const namespace of namespaces) {
            await this.addValueToCacheSet(namespace, value, setsTtl, maxSetCardinality);
        }
    }

    public async removeKeyForCache(namespace: string, key: string): Promise<void> {
        await this.resultsCacheClient.delete(`${namespace}:${key}`);
    }

    public async clearResultsCacheWithSet(namespace: string): Promise<void> {
        const keys = await this.getValuesFromCachedSet(namespace);
        if (keys?.length > 0) {
            await this.resultsCacheClient.delete(keys.map(key => `${CacheNamespaces.RESULTS_NAMESPACE}:${key}`));
            await this.clearCachedSet(namespace);
        }
    }

    public async getValuesFromCachedSet(namespace: string): Promise<string[]> {
        const setMembers = await this.recordResultsSetsClient.get(namespace);

        return setMembers ? Array.from(setMembers) : [];
    }

    /* In case of in memory strategy, we keep already hydrated objects */
    public isHydrationEnabled(): boolean {
        return false;
    }

    private async clearCachedSet(namespace: string): Promise<void> {
        await this.recordResultsSetsClient.delete(namespace);
    }

    public async refreshTTLForCachedResult(key: string, ttl: number): Promise<void> {
        // Never re-set the value read earlier: it may have been invalidated since.
        extendStoredTtl(this.resultsCacheClient, `${CacheNamespaces.RESULTS_NAMESPACE}:${key}`, ttl * 1000);
    }

    private setClients(): void {
        this.resultsCacheClient = createInMemoryCacheClientWithNamespace(CacheNamespaces.RESULTS_NAMESPACE);
        this.recordResultsSetsClient = createInMemoryCacheClientWithNamespace(CacheNamespaces.RECORD_RESULTS_SETS);
        this.documentsCacheClient = createInMemoryCacheClientWithNamespace(CacheNamespaces.DOCUMENTS);
        this.relationsCacheClient = createInMemoryCacheClientWithNamespace('relations');
    }

    private async init(): Promise<void> {
        this.setClients();
    }

    public async getDocuments<T>(keys: string[]): Promise<Map<string, CachedResult<T>>> {
        const resultsMap = new Map<string, CachedResult<T>>();
        const promises = keys.map(async key => {
            const value = await this.documentsCacheClient.get(key);
            if (value) {
                resultsMap.set(key, value as CachedResult<T>);
            }
        });
        await Promise.all(promises);
        return resultsMap;
    }

    public async setDocuments<T>(documents: Map<string, CachedResult<T>>, ttl: number): Promise<void> {
        const trackingTtl = getSetsTtlFor(ttl);

        await Promise.all(
            Array.from(documents.entries()).map(async ([key, value]) => {
                await this.documentsCacheClient.set(key, value, ttl * 1000);
                // Track document cache key by recordId for efficient invalidation
                const recordId = extractRecordIdFromDocKey(key);
                if (recordId) {
                    await this.addToTrackingSet(`${CacheNamespaces.DOCUMENT_CACHE_SETS}:${recordId}`, key, this.documentsCacheClient, member => member, trackingTtl, getMaxSetCardinality());
                }
            }),
        );
    }

    public async addParentToChildRelationship(childIdentifier: string, parentIdentifier: string, setsTtl?: number, maxSetCardinality?: number): Promise<void> {
        await this.withKeyLock(`relation:${childIdentifier}`, async () => {
            if (maxSetCardinality > 0) {
                const existing = await this.relationsCacheClient.get(childIdentifier);
                if (existing && existing.size >= maxSetCardinality) {
                    await this.relationsCacheClient.delete(childIdentifier);
                }
            }
            const parents = (await this.relationsCacheClient.get(childIdentifier)) || new Set<string>();
            parents.add(parentIdentifier);
            const ttlMs = setsTtl > 0 ? setsTtl * 1000 : undefined;
            await this.relationsCacheClient.set(childIdentifier, parents, ttlMs);
        });
    }

    public async addManyParentToChildRelationships(relationships: Array<{ childIdentifier: string; parentIdentifier: string }>, setsTtl?: number, maxSetCardinality?: number): Promise<void> {
        if (relationships.length === 0) return;

        // Group incoming relationships by child
        const incoming = new Map<string, Set<string>>();
        for (const { childIdentifier, parentIdentifier } of relationships) {
            if (!incoming.has(childIdentifier)) incoming.set(childIdentifier, new Set<string>());
            incoming.get(childIdentifier)!.add(parentIdentifier);
        }

        const ttlMs = setsTtl > 0 ? setsTtl * 1000 : undefined;
        // Process each unique child sequentially through the lock to prevent
        // lost updates when multiple calls target the same childIdentifier.
        for (const [key, newParents] of incoming.entries()) {
            await this.withKeyLock(`relation:${key}`, async () => {
                const existing = (await this.relationsCacheClient.get(key)) || new Set<string>();
                const merged = new Set<string>([...existing, ...newParents]);
                // If merged set exceeds cardinality, reset to only new parents
                const shouldReset = maxSetCardinality > 0 && merged.size > maxSetCardinality;
                await this.relationsCacheClient.set(key, shouldReset ? newParents : merged, ttlMs);
            });
        }
    }

    public async getParentsOfChild(childIdentifier: string): Promise<string[]> {
        const parents = await this.relationsCacheClient.get(childIdentifier);
        return parents ? Array.from(parents) : [];
    }

    public async removeChildRelationships(childIdentifier: string): Promise<void> {
        await this.relationsCacheClient.delete(childIdentifier);
    }

    public async clearDocumentsCache(namespace: string): Promise<void> {
        const trackingKey = `${CacheNamespaces.DOCUMENT_CACHE_SETS}:${namespace}`;
        await this.withKeyLock(`docTrack:${trackingKey}`, async () => {
            const trackedKeys = await this.recordResultsSetsClient.get(trackingKey);
            await this.recordResultsSetsClient.delete(trackingKey);
            if (trackedKeys?.size > 0) {
                await Promise.all(Array.from(trackedKeys).map(key => this.documentsCacheClient.delete(key as string)));
            }
        });
    }

    public async clearRelationshipsForModel(parentIdentifier: string): Promise<void> {
        const keysToUpdate: Array<{ key: string; parents: Set<string> }> = [];
        for await (const [key] of this.relationsCacheClient.iterator()) {
            const parents = await this.relationsCacheClient.get(key);
            if (parents?.has(parentIdentifier)) {
                keysToUpdate.push({ key, parents });
            }
        }
        await Promise.all(
            keysToUpdate.map(({ key, parents }) => {
                const updated = new Set(parents);
                updated.delete(parentIdentifier);
                return updated.size === 0 ? this.relationsCacheClient.delete(key) : this.relationsCacheClient.set(key, updated);
            }),
        );
    }
}
