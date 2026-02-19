import Redis from 'ioredis-mock';
import Container from 'typedi';
import mongoose, { Mongoose } from 'mongoose';
import Keyv from 'keyv';
import { GlobalDiContainerRegistryNames, SharedCacheStrategies, SpeedGooseConfig } from '../src/types/types';
import { InMemoryStrategy } from '../src/cachingStrategies/inMemoryStrategy';
import { applySpeedGooseCacheLayer } from '../src/wrapper';
import * as mongooseModelEvents from '../src/mongooseModelEvents';
import * as queueUtils from '../src/utils/queueUtils';
import * as commonUtils from '../src/utils/commonUtils';
import { RedisStrategy } from '../src/cachingStrategies/redisStrategy';

describe(`applySpeedGooseCacheLayer`, () => {
    it(`should register new service in DiContainer with access to redis instance`, async () => {
        const redisInstance = Container.get<typeof Redis>(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS);
        expect(redisInstance).toBeInstanceOf(Redis);
    });

    it(`should register new service in DiContainer with access to cache strategy instance`, async () => {
        const cachingStrategy = Container.get<typeof Redis>(GlobalDiContainerRegistryNames.CACHE_CLIENT_GLOBAL_ACCESS);
        expect(cachingStrategy).toBeInstanceOf(InMemoryStrategy);
    });

    it(`should register two new services in DiContainer with access to hydrated documents access`, async () => {
        const hydratedDocumentsCache = Container.get<typeof Keyv>(GlobalDiContainerRegistryNames.HYDRATED_DOCUMENTS_CACHE_ACCESS);
        const hydratedDocumentVariationsCache = Container.get<typeof Keyv>(GlobalDiContainerRegistryNames.HYDRATED_DOCUMENTS_VARIATIONS_CACHE_ACCESS);

        expect(hydratedDocumentsCache).toBeInstanceOf(Keyv);
        expect(hydratedDocumentVariationsCache).toBeInstanceOf(Keyv);
    });

    it(`should register new service in DiContainer with access to config`, async () => {
        const config = Container.get<SpeedGooseConfig>(GlobalDiContainerRegistryNames.CONFIG_GLOBAL_ACCESS);
        expect(config).toBeInstanceOf(Object);
        expect(config.redisUri).toEqual('redis://localhost:6379');
        expect(config.defaultTtl).toEqual(60);
        expect(config.sharedCacheStrategy).toBe(SharedCacheStrategies.IN_MEMORY);
        expect(config.clearModelCacheOnUpdate).toBe(false);
    });

    it(`should register new service in DiContainer with access to mongoose instance`, async () => {
        const mongoose = Container.get<Mongoose>(GlobalDiContainerRegistryNames.MONGOOSE_GLOBAL_ACCESS);
        expect(mongoose).toBeInstanceOf(Object);
        // We have one test model registered
        expect(Object.keys(mongoose.models).length).toEqual(3);
    });

    it(`should extend mongoose query interfaces with cacheQuery() function`, async () => {
        const mongoose = Container.get<Mongoose>(GlobalDiContainerRegistryNames.MONGOOSE_GLOBAL_ACCESS);
        expect(mongoose.Query.prototype.cacheQuery).toBeDefined();
    });

    it(`should extend mongoose aggregate interfaces with cachePipeline() function`, async () => {
        const mongoose = Container.get<Mongoose>(GlobalDiContainerRegistryNames.MONGOOSE_GLOBAL_ACCESS);
        expect(mongoose.Aggregate.prototype.cachePipeline).toBeDefined();
    });

    it(`should register internal mongoose events`, async () => {
        const registerListenerForInternalEventsSpy = jest.spyOn(mongooseModelEvents, 'registerListenerForInternalEvents');
        await applySpeedGooseCacheLayer(mongoose, { sharedCacheStrategy: SharedCacheStrategies.IN_MEMORY });
        expect(registerListenerForInternalEventsSpy).toHaveBeenCalled();
    });

    it(`should register new service in DiContainer with access to queues`, async () => {
        const registerInternalQueueWorkersSpy = jest.spyOn(queueUtils, 'registerInternalQueueWorkers');
        await applySpeedGooseCacheLayer(mongoose, { sharedCacheStrategy: SharedCacheStrategies.IN_MEMORY });
        expect(registerInternalQueueWorkersSpy).toHaveBeenCalled();
    });

    it(`should set redis caching strategy if it was set in config`, async () => {
        await applySpeedGooseCacheLayer(mongoose, { sharedCacheStrategy: SharedCacheStrategies.REDIS, redisUri: 'redisUri' });
        expect(commonUtils.getCacheStrategyInstance()).toBeInstanceOf(RedisStrategy);
    });

    it(`should set in memory caching strategy if it was set in config`, async () => {
        await applySpeedGooseCacheLayer(mongoose, { sharedCacheStrategy: SharedCacheStrategies.IN_MEMORY });
        expect(commonUtils.getCacheStrategyInstance()).toBeInstanceOf(InMemoryStrategy);
    });
});
