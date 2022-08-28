import * as commonUtils from "../../src/utils/commonUtils"
import {isCountQuery, isLeanQuery, prepareAggregateOperationParams, prepareQueryOperationContext, stringifyPopulatedPaths, stringifyQueryParam} from "../../src/utils/queryUtils"
import {generateAggregateParamsOperationTestData} from "../assets/utils/prepareAggregateOperationContextAssets"
import {generateQueryParamsOperationTestData} from "../assets/utils/prepareQueryOperationContextAssets"
import {generateTestFindOneQuery, generateTestFindQuery, getMongooseTestModel} from "../testUtils"

const mockedGetConfig = jest.spyOn(commonUtils, 'getConfig')

describe(`prepareQueryOperationContext`, () => {
    test(`should properly overwrite operationParams, according to query and speedGoose config`, () => {
        generateQueryParamsOperationTestData().forEach(testCase => {
            mockedGetConfig.mockReturnValue(testCase.given.config)
            prepareQueryOperationContext(testCase.given.query, testCase.given.params)

            expect(testCase.given.params).toMatchObject(testCase.expected)
        })
    })
})

describe(`prepareAggregateOperationParams`, () => {
    test(`should properly overwrite operationParams, according to aggregate pipeline and speedGoose config`, () => {
        generateAggregateParamsOperationTestData().forEach(testCase => {
            mockedGetConfig.mockReturnValue(testCase.given.config)
            prepareAggregateOperationParams(testCase.given.aggregationPipeline, testCase.given.params)

            expect(testCase.given.params).toMatchObject(testCase.expected)
        })
    })
})

describe(`isLeanQuery`, () => {
    test(`should return true if lean() method was called on find query`, async () => {
        const query = generateTestFindQuery({}).lean()

        expect(isLeanQuery(query)).toBeTruthy()
    })

    test(`should return false if lean() method was not called on find query`, async () => {
        const query = generateTestFindQuery({})

        expect(isLeanQuery(query)).toBeFalsy()
    })

    test(`should return true if lean() method was called on findOne query`, async () => {
        const query = generateTestFindOneQuery({}).lean()

        expect(isLeanQuery(query)).toBeTruthy()
    })

    test(`should return false if lean() method was not called on findOne query`, async () => {
        const query = generateTestFindOneQuery({})

        expect(isLeanQuery(query)).toBeFalsy()
    })
})

describe(`isCountQuery`, () => {
    test(`should return true when count method was called on query`, async () => {
        const query = generateTestFindQuery({}).count()

        expect(isCountQuery(query)).toBeTruthy()
    })

    test(`should return true when countDocuments method was called on query`, async () => {
        const query = generateTestFindQuery({}).countDocuments()

        expect(isCountQuery(query)).toBeTruthy()
    })

    test(`should return true when estimatedDocumentCount method was called on query`, async () => {
        const query = generateTestFindQuery({}).estimatedDocumentCount()

        expect(isCountQuery(query)).toBeTruthy()
    })

    test(`should return true if some of the count group methods were not called on find query`, async () => {
        const query = generateTestFindQuery({}).lean()

        expect(isCountQuery(query)).toBeFalsy()
    })
})

describe(`stringifyQueryParam`, () => {
    test(`should return stringified array of sorted projection key:values when using select method on query`, async () => {
        const query = getMongooseTestModel().find(
            {someField: 'someValue'},
        ).select({'fieldA': 1, 'fieldB': -1, 'aFieldThatShouldBeFirst': 1})
      
        const projectionFromQuery = query.projection() as Record<string, number>

        expect(stringifyQueryParam(projectionFromQuery)).toEqual("aFieldThatShouldBeFirst:1,fieldA:1,fieldB:-1")
    })

    test(`should return stringified array of sorted projection key:values when using projection as param in find`, async () => {
        const query = getMongooseTestModel().find(
            {someField: 'someValue'}, 'fieldA fieldB aFieldThatShouldBeFirst'
        ) 
      
        const projectionFromQuery = query.projection() as Record<string, number>

        expect(stringifyQueryParam(projectionFromQuery)).toEqual("aFieldThatShouldBeFirst:1,fieldA:1,fieldB:1")
    })
})

describe(`stringifyPopulatedPaths`, () => {
    test(`should return stringified array of sorted paths to populate`, async () => {
        const query = getMongooseTestModel().find(
            {someField: 'someValue'},
        ).populate('somePath').populate('someNextPath').populate('anotherPathThatShouldBeFirst')
      
        const projectionFromQuery = query.getPopulatedPaths()

        expect(stringifyPopulatedPaths(projectionFromQuery)).toEqual("anotherPathThatShouldBeFirst,someNextPath,somePath")
    })
})