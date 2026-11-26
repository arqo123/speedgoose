import { Container } from 'typedi';
import { Mongoose, Query } from 'mongoose';
import { GlobalDiContainerRegistryNames, SharedCacheStrategies, SpeedGooseConfig } from './types/types';
import { addCachingToQuery } from './extendQuery';
import { addCachingToAggregate } from './extendAggregate';
import { registerListenerForInternalEvents } from './mongooseModelEvents';
import { setupDebugger } from './utils/debugUtils';
import { RedisStrategy } from './cachingStrategies/redisStrategy';
import { InMemoryStrategy } from './cachingStrategies/inMemoryStrategy';
import { registerRedisClient } from './utils/redisUtils';
import { registerInternalQueueWorkers } from './utils/queueUtils';
import { handleCachedPopulation } from './utils/populationUtils';
import { ensurePopulatePathsInProjection } from './utils/queryUtils';

const prepareConfig = (config: SpeedGooseConfig): void => {
    config.debugConfig = {
        enabled: config?.debugConfig?.enabled ?? false,
        debugModels: config?.debugConfig?.debugModels ?? undefined,
        debugOperations: config?.debugConfig?.debugOperations ?? undefined,
        customLogger: config?.debugConfig?.customLogger ?? undefined,
    };
    config.sharedCacheStrategy = config.sharedCacheStrategy ?? SharedCacheStrategies.REDIS;
    config.defaultTtl = config.defaultTtl ?? 60;
    config.refreshTtlOnRead = config.refreshTtlOnRead ?? false;
    config.enabled = config.enabled ?? true;
    config.multitenancyConfig = config.multitenancyConfig ?? { multitenantKey: undefined };
    config.cacheParentLimit = config.cacheParentLimit ?? 100;
    config.clearModelCacheOnUpdate = config.clearModelCacheOnUpdate ?? false;
    config.shareCachedInstances = config.shareCachedInstances ?? false;
};

const registerGlobalConfigAccess = (config: SpeedGooseConfig): void => {
    Container.set<SpeedGooseConfig>(GlobalDiContainerRegistryNames.CONFIG_GLOBAL_ACCESS, config);
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

const wrapExecForPopulation = (mongoose: Mongoose): void => {
    const originalExec = mongoose.Query.prototype.exec;

    mongoose.Query.prototype.exec = function (...args) {
        // @ts-ignore
        const populateOptions = this._mongooseOptions.speedGoosePopulate;

        if (!populateOptions || populateOptions.length === 0 || populateOptions?.touched) {
            return originalExec.apply(this, args);
        }

        populateOptions.touched = true;
        ensurePopulatePathsInProjection(this as Query<any, any>, populateOptions);
        return originalExec.apply(this, args).then(documents => {
            if (!documents) return documents;
            // @ts-ignore
            const contextTtl = this._mongooseOptions.speedGooseTtl;
            return handleCachedPopulation(Array.isArray(documents) ? documents : [documents], populateOptions, this as Query<any, any>, contextTtl).then(populatedDocs => (Array.isArray(documents) ? populatedDocs : populatedDocs[0]));
        });
    };
};

export const applySpeedGooseCacheLayer = async (mongoose: Mongoose, config: SpeedGooseConfig): Promise<void> => {
    prepareConfig(config);
    setupDebugger(config);
    registerGlobalConfigAccess(config);
    registerGlobalMongooseAccess(mongoose);
    await registerRedisClient(config.redisUri, config.redisOptions, config.redisClient);
    await registerCacheStrategyInstance(config);
    registerInternalQueueWorkers();
    registerListenerForInternalEvents(mongoose);
    addCachingToQuery(mongoose);
    addCachingToAggregate(mongoose);
    wrapExecForPopulation(mongoose);
};
