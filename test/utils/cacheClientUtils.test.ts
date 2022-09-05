import {createInMemoryCacheClientWithNamespace} from "../../src/utils/cacheClientUtils"
import {objectDeserializer, objectSerializer} from "../../src/utils/commonUtils"

describe('createInMemoryCacheClientWithNamespace', () => {
    const cacheClient = createInMemoryCacheClientWithNamespace('testNamespace')

    test(`should return Keyv instance with opts`, () => {
        expect(cacheClient.opts.namespace).toEqual('testNamespace')
        expect(cacheClient.opts.serialize).toEqual(objectSerializer)
        expect(cacheClient.opts.deserialize).toEqual(objectDeserializer)
    })

    test(`should set and return objects as they are - without stringify `, async () => {
        const testCases = [
            {value: {obj: 'a', set: new Set()}, key: 'object'},
            {value: 'string', key: 'string'},
            {value: 123, key: 'number'},
            {value: ['someArray'], key: 'array'},
            {value: new Map(), key: 'map'},
        ]
        //setting values 
        for (const testCase of testCases) {
            await cacheClient.set(testCase.key, testCase.value)
        }

        for (const testCase of testCases) {
            expect(await cacheClient.get(testCase.key)).toEqual(testCase.value)
        }
    })
})