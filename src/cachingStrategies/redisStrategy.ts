import Redis, { RedisOptions } from 'ioredis';
import Container from 'typedi';
import { CachedResult, CacheNamespaces, GlobalDiContainerRegistryNames } from '../types/types';
import { getConfig } from '../utils/commonUtils';
import { CommonCacheStrategyAbstract } from './commonCacheStrategyAbstract';

export class RedisStrategy extends CommonCacheStrategyAbstract {
    public client: Redis;

    public static async register(): Promise<void> {
        const strategy = new RedisStrategy();
        await strategy.init();

        Container.set<RedisStrategy>(GlobalDiContainerRegistryNames.CACHE_CLIENT_GLOBAL_ACCESS, strategy);
    }

    public async getValueFromCache(namespace: string, key: string): Promise<CachedResult | null> {
        const keyWithNamespace = `${namespace}:${key}`;

        const result = await this.client.get(keyWithNamespace);

        return result ? JSON.parse(result) : null;
    }

    public async isValueCached(namespace: string, key: string): Promise<boolean> {
        const keyWithNamespace = `${namespace}:${key}`;

        return (await this.client.exists(keyWithNamespace)) === 1;
    }

    public async addValueToCache<T>(namespace: string, key: string, value: CachedResult<T>, ttl?: number): Promise<void> {
        const keyWithNamespace = `${namespace}:${key}`;

        await this.client.pipeline().set(keyWithNamespace, JSON.stringify(value)).expire(keyWithNamespace, ttl).exec();
    }

    public async addValueToCacheSet<T extends string | number>(namespace: string, value: T, setsTtl?: number, maxSetCardinality?: number): Promise<void> {
        if (maxSetCardinality > 0) {
            const size = await this.client.scard(namespace);
            if (size >= maxSetCardinality) {
                await this.client.del(namespace);
            }
        }
        const pipeline = this.client.pipeline();
        pipeline.sadd(namespace, value);
        if (setsTtl > 0) pipeline.expire(namespace, setsTtl);
        await pipeline.exec();
    }

    public async addValueToManyCachedSets<T extends string | number>(namespaces: string[], value: T, setsTtl?: number, maxSetCardinality?: number): Promise<void> {
        if (maxSetCardinality > 0 && namespaces.length > 0) {
            const pipeline = this.client.pipeline();
            for (const ns of namespaces) {
                pipeline.scard(ns);
            }
            const results = await pipeline.exec();
            const oversized = namespaces.filter((_, i) => results[i] && !results[i][0] && (results[i][1] as number) >= maxSetCardinality);
            if (oversized.length > 0) {
                await this.client.del(...oversized);
            }
        }
        const pipeline = this.client.pipeline();
        for (const namespace of namespaces) {
            pipeline.sadd(namespace, value);
            if (setsTtl > 0) pipeline.expire(namespace, setsTtl);
        }
        await pipeline.exec();
    }

    public async removeKeyForCache(namespace: string, key: string): Promise<void> {
        await this.client.del(`${namespace}:${key}`);
    }

    public async clearResultsCacheWithSet(namespace: string): Promise<void> {
        const keys = await this.getValuesFromCachedSet(namespace);
        if (keys?.length > 0) {
            const fullKeys = keys.map(key => `${CacheNamespaces.RESULTS_NAMESPACE}:${key}`);
            // Delete in batches to avoid single huge DEL command
            const BATCH = 500;
            for (let i = 0; i < fullKeys.length; i += BATCH) {
                await this.client.del(...fullKeys.slice(i, i + BATCH));
            }
            await this.clearCachedSet(namespace);
        }
    }

    public async getValuesFromCachedSet(namespace: string): Promise<string[]> {
        return this.client.smembers(namespace);
    }

    private async clearCachedSet(namespace: string): Promise<void> {
        await this.client.del(namespace);
    }

    public async refreshTTLForCachedResult(key: string, ttl: number): Promise<void> {
        const keyWithNamespace = `${CacheNamespaces.RESULTS_NAMESPACE}:${key}`;

        await this.client.expire(keyWithNamespace, ttl);
    }

    public async getDocuments<T>(keys: string[]): Promise<Map<string, CachedResult<T>>> {
        const resultsMap = new Map<string, CachedResult<T>>();
        if (keys.length === 0) return resultsMap;

        const values = await this.client.mget(keys);
        values.forEach((value, index) => {
            if (value) {
                resultsMap.set(keys[index], JSON.parse(value));
            }
        });
        return resultsMap;
    }

    public async setDocuments<T>(documents: Map<string, CachedResult<T>>, ttl: number): Promise<void> {
        if (documents.size === 0) return;

        const pipeline = this.client.pipeline();
        for (const [key, value] of documents.entries()) {
            pipeline.set(key, JSON.stringify(value), 'EX', ttl);
        }
        await pipeline.exec();
    }

    public async addParentToChildRelationship(childIdentifier: string, parentIdentifier: string, setsTtl?: number, maxSetCardinality?: number): Promise<void> {
        if (maxSetCardinality > 0) {
            const size = await this.client.scard(childIdentifier);
            if (size >= maxSetCardinality) {
                await this.client.del(childIdentifier);
            }
        }
        const pipeline = this.client.pipeline();
        pipeline.sadd(childIdentifier, parentIdentifier);
        if (setsTtl > 0) pipeline.expire(childIdentifier, setsTtl);
        await pipeline.exec();
    }

    public async addManyParentToChildRelationships(relationships: Array<{ childIdentifier: string; parentIdentifier: string }>, setsTtl?: number, maxSetCardinality?: number): Promise<void> {
        if (relationships.length === 0) return;

        // Group incoming relationships by child to count batch additions
        const grouped = new Map<string, Set<string>>();
        for (const { childIdentifier, parentIdentifier } of relationships) {
            if (!grouped.has(childIdentifier)) grouped.set(childIdentifier, new Set<string>());
            grouped.get(childIdentifier)!.add(parentIdentifier);
        }
        const uniqueChildren = [...grouped.keys()];

        const resetChildren = new Set<string>();
        if (maxSetCardinality > 0) {
            const pipeline = this.client.pipeline();
            for (const child of uniqueChildren) {
                pipeline.scard(child);
            }
            const results = await pipeline.exec();
            const oversized = uniqueChildren.filter((child, i) => {
                const currentSize = results[i] && !results[i][0] ? (results[i][1] as number) : 0;
                const incomingSize = grouped.get(child)!.size;
                return currentSize + incomingSize > maxSetCardinality;
            });
            if (oversized.length > 0) {
                await this.client.del(...oversized);
                for (const child of oversized) resetChildren.add(child);
            }
        }

        const pipeline = this.client.pipeline();
        for (const [childIdentifier, parents] of grouped.entries()) {
            // After reset, cap additions to maxSetCardinality to prevent immediate overflow
            const parentsToAdd = maxSetCardinality > 0 && resetChildren.has(childIdentifier) && parents.size > maxSetCardinality ? [...parents].slice(0, maxSetCardinality) : parents;
            for (const parentIdentifier of parentsToAdd) {
                pipeline.sadd(childIdentifier, parentIdentifier);
            }
            if (setsTtl > 0) pipeline.expire(childIdentifier, setsTtl);
        }
        await pipeline.exec();
    }

    public async getParentsOfChild(childIdentifier: string): Promise<string[]> {
        return this.client.smembers(childIdentifier);
    }

    public async removeChildRelationships(childIdentifier: string): Promise<void> {
        await this.client.del(childIdentifier);
    }

    public async clearDocumentsCache(namespace: string): Promise<void> {
        const stream = this.client.scanStream({
            match: `${namespace}:*`,
            count: 100,
        });

        for await (const keys of stream) {
            if (keys.length) {
                await this.client.del(...keys);
            }
        }
    }

    public async clearRelationshipsForModel(parentIdentifier: string): Promise<void> {
        const stream = this.client.scanStream({ match: `${CacheNamespaces.RELATIONS_CHILD_TO_PARENT}:*`, count: 100 });
        for await (const keys of stream) {
            if (keys.length === 0) continue;
            const pipeline = this.client.pipeline();
            for (const key of keys) {
                pipeline.srem(key, parentIdentifier);
            }
            await pipeline.exec();
        }
    }

    private setClient(uri?: string, redisOptions?: RedisOptions, existingClient?: Redis): void {
        if (existingClient) {
            this.client = existingClient;
        } else {
            this.client = new Redis(uri, redisOptions ?? {});
        }
    }

    private async init(): Promise<void> {
        const config = getConfig();
        this.setClient(config.redisUri, config.redisOptions, config.redisClient);
    }
}
