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

    public async addValueToCacheSet<T extends string | number>(namespace: string, value: T): Promise<void> {
        await this.client.sadd(namespace, value);
    }

    public async addValueToManyCachedSets<T extends string | number>(namespaces: string[], value: T): Promise<void> {
        const pipeline = this.client.pipeline();
        namespaces.forEach(namespace => pipeline.sadd(namespace, value));

        await pipeline.exec();
    }

    public async removeKeyForCache(namespace: string, key: string): Promise<void> {
        await this.client.del(`${namespace}:${key}`);
    }

    public async clearResultsCacheWithSet(namespace: string): Promise<void> {
        const keys = await this.getValuesFromCachedSet(namespace);
        if (keys?.length > 0) {
            await this.client.del(keys.map(key => `${CacheNamespaces.RESULTS_NAMESPACE}:${key}`));
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
    
    public async addParentToChildRelationship(childIdentifier: string, parentIdentifier: string): Promise<void> {
        await this.client.sadd(childIdentifier, parentIdentifier);
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
            count: 100
        });
        
        for await (const keys of stream) {
            if (keys.length) {
                await this.client.del(...keys);
            }
        }
    }

    public async clearRelationshipsForModel(parentIdentifier: string): Promise<void> {
        // Scan all child keys
        const stream = this.client.scanStream({ match: '*', count: 100 });
        for await (const keys of stream) {
            for (const key of keys) {
                // For each key, check if it's a child relationship set
                // (Assume child relationship keys follow a known pattern, e.g., 'child:*')
                // If not, skip
                // You may need to adjust the pattern below to match your actual child key format
                if (!key.startsWith('child:')) continue;
                const parents = await this.client.smembers(key);
                if (parents && parents.includes(parentIdentifier)) {
                    await this.client.del(key);
                }
            }
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
