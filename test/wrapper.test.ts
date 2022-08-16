import Redis from 'ioredis-mock'
import Container from 'typedi'
import {Mongoose} from 'mongoose'
import Keyv from 'keyv'
import {CacheClients, GlobalDiContainerRegistryNames, SpeedGooseConfig} from '../src/types/types'
import * as mongooseModelEvents from '../src/mongooseModelEvents'
import {cacheClientsTestCases} from './assets/wrapper'

const registerListenerForInternalEventsSpy = jest.spyOn(mongooseModelEvents,  'registerListenerForInternalEvents')

describe(`applySpeedGooseCacheLayer`, () => {

    it(`should register new service in DiContainer with access to redis instance`, async () => {
        const redisInstance = Container.get<typeof Redis>(GlobalDiContainerRegistryNames.REDIS_GLOBAL_ACCESS)
        expect(redisInstance).toBeInstanceOf(Redis)
    })

    it(`should register new service in DiContainer with access to client access`, async () => {
        const cacheClients = Container.get<CacheClients>(GlobalDiContainerRegistryNames.CACHE_CLIENT_GLOBAL_ACCESS)
        expect(Object.keys(cacheClients).length).toEqual(5)
        Object.values(cacheClients).forEach(client => expect(client).toBeInstanceOf(Keyv))

        cacheClientsTestCases.forEach(testData => {
            const client = cacheClients[testData.clientName]
            expect(client.opts.store).toBeInstanceOf(testData.expected.store)
            expect(client.opts.namespace).toEqual(testData.expected.namespace)
        });
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