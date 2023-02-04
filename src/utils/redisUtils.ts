import Redis from 'ioredis';
import { Container } from 'typedi';
import { clearHydrationCache } from './cacheClientUtils';
import { GlobalDiContainerRegistryNames, SpeedGooseRedisChannels } from '../types/types';

const redisPubSubMessageHandler = async (channel: SpeedGooseRedisChannels, recordIds: string): Promise<void> => {
    const parsedRecordIds = JSON.parse(recordIds);
    if (Array.isArray(parsedRecordIds)) {
        await Promise.all(parsedRecordIds.map(recordId => clearHydrationCache(recordId)));
    }
    await clearHydrationCache(parsedRecordIds);
};

const listenOnMessages = async (redisClient: Redis): Promise<void> => {
    await redisClient.subscribe(SpeedGooseRedisChannels.RECORDS_CHANGED);

    redisClient.on('message', redisPubSubMessageHandler);
};

export const registerRedisClient = async (uri: string): Promise<Redis> => {
    if (uri) {
        const redisClient = new Redis(uri);
        const redisListenerClient = new Redis(uri);

        Container.set<Redis>(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS, redisClient);
        Container.set<Redis>(GlobalDiContainerRegistryNames.REDIS_LISTENER_GLOBAL_ACCESS, redisListenerClient);

        await listenOnMessages(redisListenerClient);

        return redisClient;
    }
};

export const getRedisListenerInstance = (): Redis => (Container.has(GlobalDiContainerRegistryNames.REDIS_LISTENER_GLOBAL_ACCESS) ? Container.get<Redis>(GlobalDiContainerRegistryNames.REDIS_LISTENER_GLOBAL_ACCESS) : null);

export const getRedisInstance = (): Redis => (Container.has(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS) ? Container.get<Redis>(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS) : null);

export const publishRecordIdsOnChannel = (channel: SpeedGooseRedisChannels, recordIds: string | string[]): Promise<number> => getRedisInstance()?.publish(channel, JSON.stringify(recordIds));
