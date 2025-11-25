import Keyv from 'keyv';
import Container from 'typedi';
import { staticImplements } from '../types/decorators';
import { CachedResult, CacheNamespaces, GlobalDiContainerRegistryNames } from '../types/types';
import { addValueToInternalCachedSet, createInMemoryCacheClientWithNamespace } from '../utils/cacheClientUtils';
import { CommonCacheStrategyAbstract, CommonCacheStrategyStaticMethods } from './commonCacheStrategyAbstract';

@staticImplements<CommonCacheStrategyStaticMethods>()
export class InMemoryStrategy extends CommonCacheStrategyAbstract {
    private resultsCacheClient: Keyv<CachedResult<unknown>>;
    private recordResultsSetsClient: Keyv<Set<string>>;
    private documentsCacheClient: Keyv<CachedResult<unknown>>;
    private relationsCacheClient: Keyv<Set<string>>;

    public static async register(): Promise<void> {
        const strategy = new InMemoryStrategy();
        await strategy.init();

        Container.set<InMemoryStrategy>(GlobalDiContainerRegistryNames.CACHE_CLIENT_GLOBAL_ACCESS, strategy);
    }

    public async getValueFromCache(namespace: string, key: string): Promise<CachedResult> {
        const keyWithNamespace = `${namespace}:${key}`;

        return this.resultsCacheClient.get(keyWithNamespace);
    }

    public async isValueCached(namespace: string, key: string): Promise<boolean> {
        const keyWithNamespace = `${namespace}:${key}`;

        return this.resultsCacheClient.has(keyWithNamespace);
    }

    public async addValueToCache<T>(namespace: string, key: string, value: CachedResult<T>, ttl?: number): Promise<void> {
        const keyWithNamespace = `${namespace}:${key}`;

        await this.resultsCacheClient.set(keyWithNamespace, value, ttl * 1000);
    }

    public async addValueToCacheSet<T extends string | number>(namespace: string, value: T): Promise<void> {
        await addValueToInternalCachedSet(this.recordResultsSetsClient, namespace, value);
    }

    public async addValueToManyCachedSets<T extends string | number>(namespaces: string[], value: T): Promise<void> {
        await Promise.all(namespaces.map(namespace => addValueToInternalCachedSet(this.recordResultsSetsClient, namespace, value)));
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

    public async refreshTTLForCachedResult<T>(key: string, ttl: number, value: CachedResult<T>): Promise<void> {
        const keyWithNamespace = `${CacheNamespaces.RESULTS_NAMESPACE}:${key}`;

        await this.resultsCacheClient.set(keyWithNamespace, value, ttl * 1000);
    }

    private setClients(): void {
        this.resultsCacheClient = createInMemoryCacheClientWithNamespace(CacheNamespaces.RESULTS_NAMESPACE);
        this.recordResultsSetsClient = createInMemoryCacheClientWithNamespace(CacheNamespaces.RECORD_RESULTS_SETS);
        this.documentsCacheClient = createInMemoryCacheClientWithNamespace(
            CacheNamespaces.DOCUMENTS);
        this.relationsCacheClient = createInMemoryCacheClientWithNamespace(
            CacheNamespaces.RELATIONS_CHILD_TO_PARENT
        );
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
        const promises = [];
        for (const [key, value] of documents.entries()) {
            promises.push(this.documentsCacheClient.set(key, value, ttl * 1000));
        }
        await Promise.all(promises);
    }

    public async addParentToChildRelationship(childIdentifier: string, parentIdentifier: string): Promise<void> {
        const parents = (await this.relationsCacheClient.get(childIdentifier)) || new Set<string>();
        parents.add(parentIdentifier);
        await this.relationsCacheClient.set(childIdentifier, parents);
    }

    public async getParentsOfChild(childIdentifier: string): Promise<string[]> {
        const parents = await this.relationsCacheClient.get(childIdentifier);
        return parents ? Array.from(parents) : [];
    }

    public async removeChildRelationships(childIdentifier: string): Promise<void> {
        await this.relationsCacheClient.delete(childIdentifier);
    }

    public async clearDocumentsCache(namespace: string): Promise<void> {
        const keysToDelete: string[] = [];
        for await (const [key] of this.documentsCacheClient.iterator(undefined)) {
            if (key.includes(`${namespace}`)) {
                keysToDelete.push(key);
            }
        }
        await Promise.all(keysToDelete.map(key => this.documentsCacheClient.delete(key)));
    }

    public async clearRelationshipsForModel(parentIdentifier: string): Promise<void> {
        const keysToDelete: string[] = [];
        for await (const [key] of this.relationsCacheClient.iterator(undefined)) {
            const parents = await this.relationsCacheClient.get(key);
            if (parents?.has(parentIdentifier)) {
                keysToDelete.push(key);
            }
        }
        await Promise.all(keysToDelete.map(key => this.relationsCacheClient.delete(key)));
    }
}
