import Redis from 'ioredis'
import {Container} from 'typedi'
import {clearHydrationCache, getCacheClients} from './cacheClientUtils'
import {GlobalDiContainerRegistryNames, SpeedGooseRedisChannels} from '../types/types'

const listenOnMessages = async (uri: string)  : Promise<void>=> {
    const redisClient = new Redis(uri)
    await redisClient.subscribe(SpeedGooseRedisChannels.REMOVED_DOCUMENTS)
    await redisClient.subscribe(SpeedGooseRedisChannels.SAVED_DOCUMENTS)

    // NOTE: Now this logic is simple - it's just clearing cached hydrated documents. But in near future those events might be usefull
    redisClient.on('message', async (channel, recordId) => {
        await clearHydrationCache(recordId, getCacheClients())
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
