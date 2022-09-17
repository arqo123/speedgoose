import Redis from "ioredis";
import Container from "typedi";
import {staticImplements} from "../types/decorators";
import {CachedResult, CacheNamespaces, GlobalDiContainerRegistryNames} from "../types/types";
import {getConfig} from "../utils/commonUtils";
import {CommonCacheStrategyAbstract, CommonCacheStrategyStaticMethods} from "./commonCacheStrategyAbstract";

@staticImplements<CommonCacheStrategyStaticMethods>()
export class RedisStrategy extends CommonCacheStrategyAbstract {
    private client: Redis

    public static async register(): Promise<void> {
        const strategy = new RedisStrategy()
        await strategy.init()

        Container.set<RedisStrategy>(GlobalDiContainerRegistryNames.CACHE_CLIENT_GLOBAL_ACCESS, strategy)
    }

    public async getValueFromCache(namespace: string, key: string): Promise<CachedResult> {
        const keyWithNamespace = `${namespace}:${key}`

        const result = await this.client.get(keyWithNamespace)

        return result ? JSON.parse(result) : null
    }

    public async addValueToCache<T>(namespace: string, key: string, value: CachedResult<T>, ttl?: number): Promise<void> {
        const keyWithNamespace = `${namespace}:${key}`

        await this.client.pipeline().set(keyWithNamespace, JSON.stringify(value)).expire(keyWithNamespace, ttl).exec()
    }

    public async addValueToCacheSet<T extends string | number>(namespace: string, value: T): Promise<void> {
        await this.client.sadd(namespace, value)
    }

    public async addValueToManyCachedSets<T extends string | number>(namespaces: string[], value: T): Promise<void> {
        const pipeline = this.client.pipeline()
        namespaces.forEach(namespace => pipeline.sadd(namespace, value))

        await pipeline.exec()
    }

    public async removeKeyForCache(namespace: string, key: string): Promise<void> {
        await this.client.del(`${namespace}:${key}`)
    }

    public async clearResultsCacheWithSet(namespace: string): Promise<void> {
        const keys = await this.getValuesFromCachedSet(namespace)
        if (keys?.length > 0) {
            await this.client.del(keys.map(key => `${CacheNamespaces.RESULTS_NAMESPACE}:${key}`))
            await this.clearCachedSet(namespace)
        }
    }

    public async getValuesFromCachedSet(namespace: string): Promise<string[]> {
        return this.client.smembers(namespace)
    }

    private async clearCachedSet(namespace: string): Promise<void> {
        await this.client.del(namespace)
    }

    private setClient(uri: string): void {
        this.client = new Redis(uri)
    }

    private async init(): Promise<void> {
        const config = getConfig()
        this.setClient(config.redisUri)
    }
}
