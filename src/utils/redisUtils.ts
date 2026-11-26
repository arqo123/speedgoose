import Redis, { RedisOptions } from 'ioredis';
import { Container } from 'typedi';
import { GlobalDiContainerRegistryNames, SpeedGooseRedisChannels } from '../types/types';

export const registerRedisClient = async (uri?: string, redisOptions?: RedisOptions, existingClient?: Redis): Promise<Redis> => {
    const registeredClient = getRedisInstance();
    if (registeredClient) {
        return registeredClient;
    } else if (existingClient) {
        Container.set<Redis>(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS, existingClient);

        return existingClient;
    } else if (uri) {
        const redisClient = new Redis(uri, redisOptions ?? {});

        Container.set<Redis>(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS, redisClient);

        return redisClient;
    }
};

export const getRedisInstance = (): Redis => (Container.has(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS) ? Container.get<Redis>(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS) : null);

/**
 * Announces changed records. This version doesn't listen to these messages, but older speedgoose versions use them to
 * clear their local caches, so we keep sending them for rolling deploys. Remove in a later version.
 */
export const publishRecordIdsOnChannel = (channel: SpeedGooseRedisChannels, recordIds: string | string[]): Promise<number> => getRedisInstance()?.publish(channel, JSON.stringify(recordIds)) ?? Promise.resolve(0);
