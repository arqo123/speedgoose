import Redis from 'ioredis-mock'
import Container from 'typedi'
import {Mongoose} from 'mongoose'
import Keyv from 'keyv'
import {GlobalDiContainerRegistryNames, SpeedGooseConfig} from '../src/types/types'
import * as mongooseModelEvents from '../src/mongooseModelEvents'
import {CommonCacheStrategyAbstract} from '../src/cachingStrategies/commonCacheStrategyAbstract'

const registerListenerForInternalEventsSpy = jest.spyOn(mongooseModelEvents,  'registerListenerForInternalEvents')

describe(`applySpeedGooseCacheLayer`, () => {
    it(`should register new service in DiContainer with access to redis instance`, async () => {
        const redisInstance = Container.get<typeof Redis>(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS)
        expect(redisInstance).toBeInstanceOf(Redis)
    })
    
    it(`should register new service in DiContainer with access to cache strategy instance`, async () => {
        const redisInstance = Container.get<typeof Redis>(GlobalDiContainerRegistryNames.CACHE_CLIENT_GLOBAL_ACCESS)
        expect(redisInstance).toBeInstanceOf(CommonCacheStrategyAbstract)
    })

    it(`should register two new services in DiContainer with access to hydrated documents access`, async () => {
        const hydratedDocumnetsCache = Container.get<typeof Keyv>(GlobalDiContainerRegistryNames.HYDRATED_DOCUMENTS_CACHE_ACCESS)
        const hydratedDocumentVariationsCache = Container.get<typeof Keyv>(GlobalDiContainerRegistryNames.HYDRATED_DOCUMENTS_VARIATIONS_CACHE_ACCESS)
    
        expect(hydratedDocumnetsCache).toBeInstanceOf(Keyv)
        expect(hydratedDocumentVariationsCache).toBeInstanceOf(Keyv)
    })

    it(`should register new service in DiContainer with access to config`, async () => {
        const config = Container.get<SpeedGooseConfig>(GlobalDiContainerRegistryNames.CONFIG_GLOBAL_ACCESS)
        expect(config).toBeInstanceOf(Object)
        expect(config.redisUri).toEqual('redis://localhost:6379')
        expect(config.defaultTtl).toEqual(60)
    })

    it(`should register new service in DiContainer with access to mongoose instance`, async () => {
        const mongoose = Container.get<Mongoose>(GlobalDiContainerRegistryNames.MONGOOSE_GLOBAL_ACCESS)
        expect(mongoose).toBeInstanceOf(Object)
        // We have one test model registered
        expect(Object.keys(mongoose.models).length).toEqual(1)
    })

    it(`should extend mongoose query interfaces with cacheQuery() function`, async () => {
        const mongoose = Container.get<Mongoose>(GlobalDiContainerRegistryNames.MONGOOSE_GLOBAL_ACCESS)
        expect(mongoose.Query.prototype.cacheQuery).toBeDefined()
    })

    it(`should extend mongoose aggregate interfaces with cachePipeline() function`, async () => {
        const mongoose = Container.get<Mongoose>(GlobalDiContainerRegistryNames.MONGOOSE_GLOBAL_ACCESS)
        expect(mongoose.Aggregate.prototype.cachePipeline).toBeDefined()
    })

    it(`should register internal mongoose events`, async () => {
        expect(registerListenerForInternalEventsSpy).toHaveBeenCalled()
    })
})