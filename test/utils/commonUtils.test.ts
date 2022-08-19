import {getConfig, makeArrayUnique, objectDeserializer, objectSerializer} from '../../src/utils/commonUtils'
import {TEST_SPEEDGOOSE_CONFIG} from '../constants'

describe(`getConfig`, () => {
    test(`should return test config registered in DiContainer`, () => {
        expect(getConfig()).toMatchObject(TEST_SPEEDGOOSE_CONFIG)
    })
})

describe(`makeArrayUnique`, () => {
    test(`should return unique elements from array of strings and numbers`, () => {
        expect(makeArrayUnique(['a', 'b', 'c', 'abc', 'a', 'c', '1', '2', 1, 2]).sort()).toEqual(['a', 'b', 'c', 'abc', '1', '2', 1, 2].sort())
    })
})

describe(`objectSerializer`, () => {
    test(`should return object without mutating it`, () => {
        const testObject = {a: '1', b: '2', c: 'c'}
        //in that case we also want to compare if it's the same object or some kind of copy
        expect(objectSerializer(testObject)).toEqual(testObject)
        expect(objectSerializer(testObject)).toMatchObject(testObject)
    })
})

describe(`objectDeserializer`, () => {
    test(`should return object without mutating it`, () => {
        const testObject = {a: '1', b: '2', c: 'c'}
        //in that case we also want to compare if it's the same object or some kind of copy
        expect(objectDeserializer(testObject)).toEqual(testObject)
        expect(objectDeserializer(testObject)).toMatchObject(testObject)
    })
})

