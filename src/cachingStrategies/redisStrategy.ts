import Redis, { RedisOptions } from 'ioredis';
import Container from 'typedi';
import { CachedResult, CacheNamespaces, GlobalDiContainerRegistryNames } from '../types/types';
import { getConfig } from '../utils/commonUtils';
import { getMaxSetCardinality, getSetsTtlFor } from '../utils/cacheClientUtils';
import { CommonCacheStrategyAbstract, extractRecordIdFromDocKey } from './commonCacheStrategyAbstract';

// Members checked for an expired result on every write. With k samples the share of dead
// members settles around 1/k, so a set holds roughly k/(k-1) times its live keys.
const EXPIRED_MEMBERS_SAMPLE_SIZE = 4;

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

// Lua script: add a key to the invalidation sets of many namespaces (model/records/documents).
// Each member names a cached value stored at <valuesPrefix><member>.
// - Samples a few members and drops those whose value has already expired. Without it, a set written
//   more often than its TTL never expires and keeps every key ever added.
// - When the set is full, evicts members together with their values, so no cached value is left
//   that invalidation can no longer reach.
// - Only ever extends the set TTL, so a short-lived value cannot make it expire before a longer-lived one.
// KEYS = all namespace keys, ARGV[1] = value, ARGV[2] = maxSetCardinality, ARGV[3] = ttl, ARGV[4] = values key prefix
const LUA_ADD_TO_MANY_SETS = `
local value = ARGV[1]
local maxCard = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local valuesPrefix = ARGV[4]
for i = 1, #KEYS do
    local size = redis.call('SCARD', KEYS[i])
    if size > 0 then
        local sample = redis.call('SRANDMEMBER', KEYS[i], ${EXPIRED_MEMBERS_SAMPLE_SIZE})
        for _, member in ipairs(sample) do
            if redis.call('EXISTS', valuesPrefix .. member) == 0 then
                size = size - redis.call('SREM', KEYS[i], member)
            end
        end
    end
    if maxCard > 0 and size >= maxCard and redis.call('SISMEMBER', KEYS[i], value) == 0 then
        local evicted = redis.call('SPOP', KEYS[i], size - maxCard + 1)
        for _, member in ipairs(evicted) do
            redis.call('UNLINK', valuesPrefix .. member)
        end
    end
    redis.call('SADD', KEYS[i], value)
    if ttl > 0 and redis.call('TTL', KEYS[i]) < ttl then
        redis.call('EXPIRE', KEYS[i], ttl)
    end
end
return #KEYS
`;

// Lua script: delete every value tracked in a set (members are value keys without the ioredis keyPrefix,
// which ioredis does not apply to keys built inside a script), then the set itself.
// Deletes in chunks: unpack() of more than ~8000 values fails.
// KEYS[1] = tracking set, ARGV[1] = keyPrefix
const LUA_DELETE_TRACKED_VALUES = `
local members = redis.call('SMEMBERS', KEYS[1])
local batch = {}
for _, member in ipairs(members) do
    batch[#batch + 1] = ARGV[1] .. member
    if #batch == 500 then
        redis.call('UNLINK', unpack(batch))
        batch = {}
    end
end
if #batch > 0 then
    redis.call('UNLINK', unpack(batch))
end
redis.call('DEL', KEYS[1])
return #members
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

        // A single SET ... EX: with a separate EXPIRE, a failing EXPIRE left a result that never expired.
        await (ttl > 0 ? this.client.set(keyWithNamespace, JSON.stringify(value), 'EX', ttl) : this.client.set(keyWithNamespace, JSON.stringify(value)));
    }

    public async addValueToCacheSet<T extends string | number>(namespace: string, value: T, setsTtl?: number, maxSetCardinality?: number): Promise<void> {
        await this.client.eval(LUA_ADD_TO_MANY_SETS, 1, namespace, String(value), String(maxSetCardinality ?? 0), String(setsTtl ?? 0), this.getResultsKeyPrefix());
    }

    public async addValueToManyCachedSets<T extends string | number>(namespaces: string[], value: T, setsTtl?: number, maxSetCardinality?: number): Promise<void> {
        if (namespaces.length === 0) return;
        await this.client.eval(LUA_ADD_TO_MANY_SETS, namespaces.length, ...namespaces, String(value), String(maxSetCardinality ?? 0), String(setsTtl ?? 0), this.getResultsKeyPrefix());
    }

    // Keys built inside Lua are not prefixed by ioredis, only KEYS[] are.
    private getKeyPrefix(): string {
        return this.client.options?.keyPrefix ?? '';
    }

    private getResultsKeyPrefix(): string {
        return `${this.getKeyPrefix()}${CacheNamespaces.RESULTS_NAMESPACE}:`;
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
        const trackingTtl = getSetsTtlFor(ttl);

        const pipeline = this.client.pipeline();
        for (const [key, value] of documents.entries()) {
            pipeline.set(key, JSON.stringify(value), 'EX', ttl);
        }
        await pipeline.exec();

        // Track document cache key by recordId for efficient invalidation. Only after the documents are
        // written, as the script drops members whose value does not exist.
        await Promise.all(
            Array.from(documents.keys()).map(key => {
                const recordId = extractRecordIdFromDocKey(key);
                if (!recordId) return undefined;
                const trackingKey = `${CacheNamespaces.DOCUMENT_CACHE_SETS}:${recordId}`;
                return this.client.eval(LUA_ADD_TO_MANY_SETS, 1, trackingKey, key, String(getMaxSetCardinality()), String(trackingTtl), this.getKeyPrefix());
            }),
        );
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
        await this.client.eval(LUA_DELETE_TRACKED_VALUES, 1, trackingKey, this.getKeyPrefix());
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
