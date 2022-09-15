import {CachedLeanDocument, CachedResult} from "../../src/types/types"
import {generateCacheKeyForModelName, generateCacheKeyForRecordAndModelName, generateCacheKeyForSingleDocument} from "../../src/utils/cacheKeyUtils"
import * as commonUtils from "../../src/utils/commonUtils"
import {generateCacheKeyForRecordAndModelNameTestData, generateCacheKeyForSingleDocumentTestData} from "../assets/utils/cacheKeyUtils"

const mockedGetConfig = jest.spyOn(commonUtils, 'getConfig')

describe(`generateCacheKeyForRecordAndModelName`, () => {
    test(`should properly generate key for record and model name `, () => {
        generateCacheKeyForRecordAndModelNameTestData().forEach(testCase => {
            mockedGetConfig.mockReturnValue(testCase.given.config)

            const key = generateCacheKeyForRecordAndModelName(testCase.given.record, testCase.given.modelName)
            expect(key).toEqual(testCase.expected)
        })
    })
})

describe(`generateCacheKeyForModelName`, () => {
    test(`should properly generate key when multitenantValue is in input`, () => {
        expect(generateCacheKeyForModelName('testModelName','multitenantValue')).toEqual('testModelName_multitenantValue')
    })
 
    test(`should properly generate key when multitenantValue is NOT in input`, () => {
        expect(generateCacheKeyForModelName('testModelName')).toEqual('testModelName_')
    })
})

describe(`generateCacheKeyForSingleDocument`, () => {
    test(`should properly generate key for record and model name `, () => {
        generateCacheKeyForSingleDocumentTestData().forEach(testCase => {
            const key = generateCacheKeyForSingleDocument(testCase.given.query, testCase.given.record as CachedLeanDocument<unknown>) 
            expect(key).toEqual(testCase.expected)
        })
    })
})