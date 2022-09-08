import {CacheNamespaces} from "../../src/types/types"
import * as cacheClientUtils from "../../src/utils/cacheClientUtils"
import {getCacheStrategyInstance, objectDeserializer, objectSerializer} from "../../src/utils/commonUtils"
import {cachingTestCases} from "../assets/utils/cacheClientUtils"
import {generateTestDocument} from "../testUtils"
import * as commonUtils from "../../src/utils/commonUtils"
import {ObjectId} from "mongodb"

const mockedGetHydrationCache = jest.spyOn(commonUtils, 'getHydrationCache')
const addValueToInternalCachedSet = jest.spyOn(cacheClientUtils, 'addValueToInternalCachedSet')


describe('createInMemoryCacheClientWithNamespace', () => {
    const cacheClient = cacheClientUtils.createInMemoryCacheClientWithNamespace('testNamespace')

    test(`should return Keyv instance with opts`, () => {
        expect(cacheClient.opts.namespace).toEqual('testNamespace')
        expect(cacheClient.opts.serialize).toEqual(objectSerializer)
        expect(cacheClient.opts.deserialize).toEqual(objectDeserializer)
    })

    test(`should set and return objects as they are - without stringify `, async () => {

        //setting values 
        for (const testCase of cachingTestCases) {
            await cacheClient.set(testCase.key, testCase.value)
        }

        for (const testCase of cachingTestCases) {
            expect(await cacheClient.get(testCase.key)).toEqual(testCase.value)
        }
    })
})

describe('getResultsFromCache', () => {
    test(`should set and return objects as they are - without stringify when using getResultsFromCache`, async () => {

        for (const testCase of cachingTestCases) {
            await getCacheStrategyInstance().addValueToCache(CacheNamespaces.RESULTS_NAMESPACE, testCase.key, testCase.value)
        }

        for (const testCase of cachingTestCases) {
            expect(await cacheClientUtils.getResultsFromCache(testCase.key)).toEqual(testCase.value)
        }
    })
})

describe('setKeyInHydrationCaches', () => {
    const id1 = new ObjectId()
    const id2 = new ObjectId()

    const document1 = generateTestDocument({_id: id1, name: 'testModelName1'})
    const document2 = generateTestDocument({_id: id2, name: 'testModelName2'})
    const document3 = generateTestDocument({_id: id1, name: 'testModelName1_withVariation', fieldA: 'fieldA'})

    beforeAll(async () => {
        await cacheClientUtils.setKeyInHydrationCaches('testKey1', document1, {})
        await cacheClientUtils.setKeyInHydrationCaches('testKey2', document2, {})
        await cacheClientUtils.setKeyInHydrationCaches('testKey1_varation', document3, {})
    })

    test(`keys after set should be accessible with the getHydrationCache method`, async () => {
        expect(mockedGetHydrationCache).toBeCalled()
        expect(addValueToInternalCachedSet).toBeCalled()

        expect(await commonUtils.getHydrationCache().get('testKey1')).toEqual(document1)
        expect(await commonUtils.getHydrationCache().get('testKey2')).toEqual(document2)
        expect(await commonUtils.getHydrationCache().get('testKey1_varation')).toEqual(document3)
    })

    test(`getHydrationVariationsCache should return set with unique keys `, async () => {
        const set1 = await commonUtils.getHydrationVariationsCache().get(id1.toString()) as Set<string>
        const set2 = await commonUtils.getHydrationVariationsCache().get(id2.toString()) as Set<string>

        expect(Array.from(set1).sort()).toEqual(['testKey1', 'testKey1_varation'].sort())
        expect(Array.from(set2).sort()).toEqual(['testKey2',].sort())
    })

    test(`should allow to overwrite keys in hydration cache `, async () => {
        const document4 = generateTestDocument({_id: id1, name: 'someBrandNewDocumentToOverwrite'})
        await cacheClientUtils.setKeyInHydrationCaches('testKey1', document4, {})

        expect(mockedGetHydrationCache).toBeCalled()
        expect(addValueToInternalCachedSet).toBeCalled()

        expect(await commonUtils.getHydrationCache().get('testKey1')).not.toEqual(document1)
        expect(await commonUtils.getHydrationCache().get('testKey1')).toEqual(document4)

        const set1 = await commonUtils.getHydrationVariationsCache().get(id1.toString()) as Set<string>
        expect(Array.from(set1).sort()).toEqual(['testKey1', 'testKey1_varation'].sort())
    })
})
