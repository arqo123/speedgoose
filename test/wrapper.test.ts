import './setupTestEnv'
import Redis from 'ioredis-mock'
import Container from 'typedi'
import {CacheClients, GlobalDiContainerRegistryNames} from '../src/types/types'
import Keyv from 'keyv'
import {cacheClientsTestCases} from './assets.ts/wrapper'

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
})