import Redis from 'ioredis'
import {Container} from 'typedi'
import {clearHydrationCache} from './cacheClientUtils'
import {CacheNamespaces, GlobalDiContainerRegistryNames, SpeedGooseRedisChannels} from '../types/types'

const listenOnMessages = async (uri: string): Promise<void> => {
    const redisClient = new Redis(uri)
    await redisClient.subscribe(SpeedGooseRedisChannels.REMOVED_DOCUMENTS)
    await redisClient.subscribe(SpeedGooseRedisChannels.SAVED_DOCUMENTS)

    // NOTE: Now this logic is simple - it's just clearing cached hydrated documents. But in near future those events might be usefull
    redisClient.on('message', async (channel, recordId) => {
        await clearHydrationCache(recordId)
    })
}

export const registerRedisClient = async (uri: string): Promise<Redis> => {
    const redisClient = new Redis(uri)

    Container.set<Redis>(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS, redisClient)

    await listenOnMessages(uri)

    return redisClient
}

export const getRedisInstance = (): Redis => Container.get<Redis>(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS)

export const publishRecordIdOnChannel = (channel: SpeedGooseRedisChannels, recordId: string): Promise<number> =>
    getRedisInstance().publish(channel, recordId)

export const addValueToCache = async <T>(namespace: string, key: string, value: T, ttl?: number): Promise<void> => {
    const keyWithNamespace = `${namespace}:${key}`

    await getRedisInstance().pipeline().set(keyWithNamespace, JSON.stringify(value)).expire(keyWithNamespace, ttl).exec()
}
export const getValueFromCache = async (namespace: string, key: string): Promise<unknown> => {
    const keyWithNamespace = `${namespace}:${key}`

    const result = await getRedisInstance().get(keyWithNamespace)

    return result ? JSON.parse(result) : null
}

export const removeKeyFromCache = async (namespace: string, key: string): Promise<number> =>
    getRedisInstance().del(`${namespace}:${key}`)

export const addValueToCacheSet = async (setNamespace: string, value: string): Promise<number> =>
    getRedisInstance().sadd(setNamespace, value)

export const addValueToManyCachedSets = async (setNamespaces: string[], value: string): Promise<void> => {
    const pipeline = getRedisInstance().pipeline()
    setNamespaces.forEach(namespace => pipeline.sadd(namespace, value))

    await pipeline.exec()
}

export const getValuesFromCachedSet = async (setNamespace: string): Promise<string[]> =>
    getRedisInstance().smembers(setNamespace)

export const clearCachedSet = async (setNamespace: string): Promise<number> =>
    getRedisInstance().del(setNamespace)

export const clearResultsCacheWithSet = async (setNamespace: string): Promise<void> => {
    const keys = await getValuesFromCachedSet(setNamespace)
    if (keys?.length > 0) {
        await getRedisInstance().del(keys.map(key => `${CacheNamespaces.RESULTS_NAMESPACE}:${key}`))
        await clearCachedSet(setNamespace)
    }
}
