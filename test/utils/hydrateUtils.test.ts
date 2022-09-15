import {Document} from 'mongoose'
import {CachedLeanDocument} from '../../src/types/types'
import {hydrateResults} from "../../src/utils/hydrationUtils"
import {prepareHydrateResultsTestCases} from "../assets/utils/hydrateResults"
import {MongooseTestDocument, TestModel} from '../types'


describe(`hydrateResults`, () => {

    const checkDocumentConsistency = (hydratedRecord: MongooseTestDocument, sourceRecord: CachedLeanDocument<TestModel>): void => {
        expect(hydratedRecord).toBeInstanceOf(Document)

        expect(String(hydratedRecord._id)).toEqual(String(sourceRecord._id))
        expect(hydratedRecord.fieldA).toEqual(sourceRecord.fieldA)
        expect(hydratedRecord.name).toEqual(sourceRecord.name)
    }

    const runTest = (hydratedResult: MongooseTestDocument, sourceRecord: CachedLeanDocument<TestModel>) => {

        checkDocumentConsistency(hydratedResult, sourceRecord)
        //   testing nested documents
        if (sourceRecord.relationField) {
            checkDocumentConsistency(hydratedResult.relationField as MongooseTestDocument, sourceRecord.relationField as CachedLeanDocument<TestModel>)
            runTest(hydratedResult.relationField as MongooseTestDocument, sourceRecord.relationField as CachedLeanDocument<TestModel>)
        }
        const relationArray = sourceRecord?.relationArray as CachedLeanDocument<TestModel>[]

        if (relationArray?.length > 0) {
            relationArray.forEach((relation, index) => {
                checkDocumentConsistency((hydratedResult.relationArray as MongooseTestDocument[])[index] as MongooseTestDocument, relationArray[index] as CachedLeanDocument<TestModel>)
                runTest((hydratedResult.relationArray as MongooseTestDocument[])[index] as MongooseTestDocument, relationArray[index] as CachedLeanDocument<TestModel>)
            }
            )
        }
    }

    test(`should properly recreate all documents from raw objects and turn them into deep populated documents`, () => {
        prepareHydrateResultsTestCases().forEach(async testCase => {
            const hydratedResult = await hydrateResults<TestModel>(testCase.query, {}, testCase.record) as MongooseTestDocument
            runTest(hydratedResult, testCase.record)
        })
    })
})