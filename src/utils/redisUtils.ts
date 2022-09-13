import Redis from 'ioredis'
import {Container} from 'typedi'
import {clearHydrationCache} from './cacheClientUtils'
import {GlobalDiContainerRegistryNames, SpeedGooseRedisChannels} from '../types/types'

 const redisPubSubMessageHandler = async (channel: SpeedGooseRedisChannels, recordId: string): Promise<void> => {
    await clearHydrationCache(recordId)
}

const listenOnMessages = async (redisClient : Redis): Promise<void> => {
    await redisClient.subscribe(SpeedGooseRedisChannels.REMOVED_DOCUMENTS)
    await redisClient.subscribe(SpeedGooseRedisChannels.SAVED_DOCUMENTS)

    // NOTE: Now this logic is simple - it's just clearing cached hydrated documents. But in near future those events might be usefull
    redisClient.on('message', redisPubSubMessageHandler)
}

export const registerRedisClient = async (uri: string): Promise<Redis> => {
    if (uri) {
        const redisClient = new Redis(uri)
        const redisListenerClient = new Redis(uri)

        Container.set<Redis>(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS, redisClient)
        Container.set<Redis>(GlobalDiContainerRegistryNames.REDIS_LISTENER_GLOBAL_ACCESS, redisListenerClient)

        await listenOnMessages(redisListenerClient)

        return redisClient
    }
}

export const getRedisListenerInstance = (): Redis =>
    Container.has(GlobalDiContainerRegistryNames.REDIS_LISTENER_GLOBAL_ACCESS) ?
        Container.get<Redis>(GlobalDiContainerRegistryNames.REDIS_LISTENER_GLOBAL_ACCESS) : null

export const getRedisInstance = (): Redis =>
    Container.has(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS) ?
        Container.get<Redis>(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS) : null

export const publishRecordIdOnChannel = (channel: SpeedGooseRedisChannels, recordId: string): Promise<number> =>
    getRedisInstance()?.publish(channel, recordId)

