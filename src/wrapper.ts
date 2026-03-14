import { Container } from 'typedi';
import Keyv from 'keyv';
import { Document, Mongoose, Query } from 'mongoose';
import { CacheNamespaces, GlobalDiContainerRegistryNames, SharedCacheStrategies, SpeedGooseConfig, SpeedGoosePopulateOptions } from './types/types';
import { addCachingToQuery } from './extendQuery';
import { addCachingToAggregate } from './extendAggregate';
import { registerListenerForInternalEvents } from './mongooseModelEvents';
import { setupDebugger } from './utils/debugUtils';
import { RedisStrategy } from './cachingStrategies/redisStrategy';
import { createInMemoryCacheClientWithNamespace } from './utils/cacheClientUtils';
import { InMemoryStrategy } from './cachingStrategies/inMemoryStrategy';
import { registerRedisClient } from './utils/redisUtils';
import { registerInternalQueueWorkers } from './utils/queueUtils';
import { handleCachedPopulation } from './utils/populationUtils';

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

/**
 * Ensures that populate paths are included in the query's projection.
 * Without this, an inclusive select like `.select('name email')` would not return
 * the ObjectId field needed for population, causing cachePopulate to silently skip.
 * Mirrors native Mongoose behavior in Query.prototype._castFields().
 */
const ensurePopulatePathsInProjection = (query: Query<any, any>, populateOptions: SpeedGoosePopulateOptions[]): void => {
    const projection = query.projection() as Record<string, any> | null;
    if (!projection || Object.keys(projection).length === 0) return;

    const isInclusive = Object.entries(projection).some(([key, val]) => key !== '_id' && (val === 1 || val === true));
    if (!isInclusive) return;

    for (const opt of populateOptions) {
        const rootField = opt.path.split('.')[0];
        if (!projection[rootField]) {
            query.select(rootField);
        }
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
            return handleCachedPopulation(Array.isArray(documents) ? documents : [documents], populateOptions, this as Query<any, any>).then(populatedDocs => (Array.isArray(documents) ? populatedDocs : populatedDocs[0]));
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
    registerHydrationCaches();
    registerListenerForInternalEvents(mongoose);
    addCachingToQuery(mongoose);
    addCachingToAggregate(mongoose);
    wrapExecForPopulation(mongoose);
};
