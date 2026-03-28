import Redis, { RedisOptions } from 'ioredis';
import Container from 'typedi';
import { CachedResult, CacheNamespaces, GlobalDiContainerRegistryNames } from '../types/types';
import { getConfig } from '../utils/commonUtils';
import { CommonCacheStrategyAbstract, extractRecordIdFromDocKey } from './commonCacheStrategyAbstract';

// Lua script: atomic SCARD check + DEL if oversized + SADD + optional EXPIRE
// KEYS[1] = set key, ARGV[1] = value, ARGV[2] = maxSetCardinality, ARGV[3] = ttl
const LUA_ADD_TO_SET = `
local maxCard = tonumber(ARGV[2])
if maxCard > 0 then
    local size = redis.call('SCARD', KEYS[1])
    if size >= maxCard then
        redis.call('DEL', KEYS[1])
    end
end
redis.call('SADD', KEYS[1], ARGV[1])
local ttl = tonumber(ARGV[3])
if ttl > 0 then
    redis.call('EXPIRE', KEYS[1], ttl)
end
return 1
`;

// Lua script: same as above but for multiple keys (namespaces)
// KEYS = all namespace keys, ARGV[1] = value, ARGV[2] = maxSetCardinality, ARGV[3] = ttl
const LUA_ADD_TO_MANY_SETS = `
local value = ARGV[1]
local maxCard = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
for i = 1, #KEYS do
    if maxCard > 0 then
        local size = redis.call('SCARD', KEYS[i])
        if size >= maxCard then
            redis.call('DEL', KEYS[i])
        end
    end
    redis.call('SADD', KEYS[i], value)
    if ttl > 0 then
        redis.call('EXPIRE', KEYS[i], ttl)
    end
end
return #KEYS
`;

// Lua script: atomic per-child relationship addition with cardinality check
// KEYS[1] = child key
// ARGV[1] = maxSetCardinality, ARGV[2] = ttl, ARGV[3..N] = parent identifiers
const LUA_ADD_PARENTS_TO_CHILD = `
local maxCard = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local numParents = #ARGV - 2
if maxCard > 0 then
    local size = redis.call('SCARD', KEYS[1])
    if size + numParents > maxCard then
        redis.call('DEL', KEYS[1])
        if numParents > maxCard then
            numParents = maxCard
        end
    end
end
for i = 3, 2 + numParents do
    redis.call('SADD', KEYS[1], ARGV[i])
end
if ttl > 0 then
    redis.call('EXPIRE', KEYS[1], ttl)
end
return numParents
`;

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
        await this.client.eval(LUA_ADD_TO_SET, 1, namespace, String(value), String(maxSetCardinality ?? 0), String(setsTtl ?? 0));
    }

    public async addValueToManyCachedSets<T extends string | number>(namespaces: string[], value: T, setsTtl?: number, maxSetCardinality?: number): Promise<void> {
        if (namespaces.length === 0) return;
        await this.client.eval(LUA_ADD_TO_MANY_SETS, namespaces.length, ...namespaces, String(value), String(maxSetCardinality ?? 0), String(setsTtl ?? 0));
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

        // Use consistent tracking TTL from config. Honors setsTtl: 0 (no expiry).
        // Ensures tracking set outlives the documents it tracks.
        const config = getConfig();
        const configTtl = config?.setsTtl !== undefined ? config.setsTtl : (config?.defaultTtl ?? 60) * 2;
        const trackingTtl = configTtl > 0 ? Math.max(configTtl, ttl) : configTtl;

        const pipeline = this.client.pipeline();
        for (const [key, value] of documents.entries()) {
            pipeline.set(key, JSON.stringify(value), 'EX', ttl);
            // Track document cache key by recordId for efficient invalidation
            const recordId = extractRecordIdFromDocKey(key);
            if (recordId) {
                const trackingKey = `${CacheNamespaces.DOCUMENT_CACHE_SETS}:${recordId}`;
                pipeline.sadd(trackingKey, key);
                if (trackingTtl > 0) pipeline.expire(trackingKey, trackingTtl);
            }
        }
        await pipeline.exec();
    }

    public async addParentToChildRelationship(childIdentifier: string, parentIdentifier: string, setsTtl?: number, maxSetCardinality?: number): Promise<void> {
        await this.client.eval(LUA_ADD_TO_SET, 1, childIdentifier, parentIdentifier, String(maxSetCardinality ?? 0), String(setsTtl ?? 0));
    }

    public async addManyParentToChildRelationships(relationships: Array<{ childIdentifier: string; parentIdentifier: string }>, setsTtl?: number, maxSetCardinality?: number): Promise<void> {
        if (relationships.length === 0) return;

        // Group incoming relationships by child to deduplicate
        const grouped = new Map<string, Set<string>>();
        for (const { childIdentifier, parentIdentifier } of relationships) {
            if (!grouped.has(childIdentifier)) grouped.set(childIdentifier, new Set<string>());
            grouped.get(childIdentifier)!.add(parentIdentifier);
        }

        // Execute one atomic Lua script per unique child
        const promises: Promise<unknown>[] = [];
        for (const [childIdentifier, parents] of grouped.entries()) {
            const parentArgs = [...parents];
            promises.push(this.client.eval(LUA_ADD_PARENTS_TO_CHILD, 1, childIdentifier, String(maxSetCardinality ?? 0), String(setsTtl ?? 0), ...parentArgs));
        }
        await Promise.all(promises);
    }

    public async getParentsOfChild(childIdentifier: string): Promise<string[]> {
        return this.client.smembers(childIdentifier);
    }

    public async removeChildRelationships(childIdentifier: string): Promise<void> {
        await this.client.del(childIdentifier);
    }

    public async clearDocumentsCache(namespace: string): Promise<void> {
        const trackingKey = `${CacheNamespaces.DOCUMENT_CACHE_SETS}:${namespace}`;
        // Atomic: read tracked keys, delete them + tracking set in one Lua call.
        // Prevents race where setDocuments adds a key between SMEMBERS and DEL.
        await this.client.eval(
            `local keys = redis.call('SMEMBERS', KEYS[1])
             if #keys > 0 then redis.call('DEL', unpack(keys)) end
             redis.call('DEL', KEYS[1])
             return #keys`,
            1,
            trackingKey,
        );
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
