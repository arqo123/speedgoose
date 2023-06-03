import { Container } from 'typedi';
import { Document, Mongoose } from 'mongoose';
import Keyv from 'keyv';
import { CacheNamespaces, GlobalDiContainerRegistryNames, SharedCacheStrategies, SpeedGooseConfig } from './types/types';
import { addCachingToQuery } from './extendQuery';
import { addCachingToAggregate } from './extendAggregate';
import { registerListenerForInternalEvents } from './mongooseModelEvents';
import { setupDebugger } from './utils/debugUtils';
import { RedisStrategy } from './cachingStrategies/redisStrategy';
import { createInMemoryCacheClientWithNamespace } from './utils/cacheClientUtils';
import { InMemoryStrategy } from './cachingStrategies/inMemoryStrategy';
import { registerRedisClient } from './utils/redisUtils';
import { registerInternalQueueWorkers } from './utils/queueUtils';

const prepareConfig = (config: SpeedGooseConfig): void => {
    (config.debugConfig = {
        enabled: config?.debugConfig?.enabled ?? false,
        debugModels: config?.debugConfig?.debugModels ?? undefined,
        debugOperations: config?.debugConfig?.debugOperations ?? undefined,
    }),
        (config.sharedCacheStrategy = config.sharedCacheStrategy ?? SharedCacheStrategies.REDIS);
    config.defaultTtl = config.defaultTtl ?? 60;
    config.refreshTtlOnRead = config.refreshTtlOnRead ?? false;
    config.enabled = config.enabled ?? true;
    config.multitenancyConfig = config.multitenancyConfig ?? { multitenantKey: undefined };
};

const registerGlobalConfigAccess = (config: SpeedGooseConfig): void => {
    Container.set<SpeedGooseConfig>(GlobalDiContainerRegistryNames.CONFIG_GLOBAL_ACCESS, config);
};

const registerHydrationCaches = (): void => {
    Container.set<Keyv<Document>>(GlobalDiContainerRegistryNames.HYDRATED_DOCUMENTS_CACHE_ACCESS, createInMemoryCacheClientWithNamespace(CacheNamespaces.HYDRATED_DOCUMENTS_NAMESPACE));

    Container.set<Keyv<Set<string>>>(GlobalDiContainerRegistryNames.HYDRATED_DOCUMENTS_VARIATIONS_CACHE_ACCESS, createInMemoryCacheClientWithNamespace(CacheNamespaces.HYDRATED_DOCUMENTS_VARIATIONS_KEY_NAMESPACE));
};

const registerGlobalMongooseAccess = (mongoose: Mongoose): void => {
    Container.set<Mongoose>(GlobalDiContainerRegistryNames.MONGOOSE_GLOBAL_ACCESS, mongoose);
};

const registerCacheStrategyInstance = (config: SpeedGooseConfig): Promise<void> => {
    switch (config.sharedCacheStrategy) {
        case SharedCacheStrategies.IN_MEMORY:
            return InMemoryStrategy.register();
        case SharedCacheStrategies.REDIS:
        default:
            return RedisStrategy.register();
    }
};

export const applySpeedGooseCacheLayer = async (mongoose: Mongoose, config: SpeedGooseConfig): Promise<void> => {
    prepareConfig(config);
    setupDebugger(config);
    registerGlobalConfigAccess(config);
    registerGlobalMongooseAccess(mongoose);
    await registerRedisClient(config.redisUri);
    await registerCacheStrategyInstance(config);
    registerInternalQueueWorkers();
    registerHydrationCaches();
    registerListenerForInternalEvents(mongoose);
    addCachingToQuery(mongoose);
    addCachingToAggregate(mongoose);
};
