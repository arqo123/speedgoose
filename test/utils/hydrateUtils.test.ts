import { Document, isObjectIdOrHexString, Schema } from 'mongoose';
import { CachedDocument, CachedLeanDocument } from '../../src/types/types';
import { getReferenceModelNameFromSchema, hydrateResults } from '../../src/utils/hydrationUtils';
import { isResultWithId } from '../../src/utils/mongooseUtils';
import { prepareHydrateResultsTestCases } from '../assets/utils/hydrateResults';
import { MongooseTestDocument, TestModel } from '../types';

describe(`getReferenceModelNameFromSchema`, () => {
    test(`should handle empty type array`, () => {
        const testSchema = new Schema({ emptyTypeArray: [] });
        expect(getReferenceModelNameFromSchema(testSchema.path('emptyTypeArray'))).toEqual(undefined);
    });
});
describe(`hydrateResults`, () => {
    const checkDocumentConsistency = (result: MongooseTestDocument, sourceRecord: CachedLeanDocument<TestModel>): void => {
        //checking if the source record is just an id
        if (isObjectIdOrHexString(sourceRecord)) {
            expect(isObjectIdOrHexString(result)).toBeTruthy();
            expect(sourceRecord).toEqual(result);
        } else {
            expect(result).toBeInstanceOf(Document);

            expect(String(result._id)).toEqual(String(sourceRecord._id));
            expect(result.fieldA).toEqual(sourceRecord.fieldA);
            expect(result.name).toEqual(sourceRecord.name);
        }
    };

    const runTest = (hydratedResult: MongooseTestDocument, sourceRecord: CachedLeanDocument<TestModel>) => {
        checkDocumentConsistency(hydratedResult, sourceRecord);
        //   testing nested documents
        if (sourceRecord.relationField) {
            checkDocumentConsistency(hydratedResult.relationField as MongooseTestDocument, sourceRecord.relationField as CachedLeanDocument<TestModel>);
            runTest(hydratedResult.relationField as MongooseTestDocument, sourceRecord.relationField as CachedLeanDocument<TestModel>);
        }

        const relationArray = sourceRecord?.relationArray as CachedLeanDocument<TestModel>[];

        if (relationArray?.length > 0) {
            relationArray.forEach((relation, index) => {
                checkDocumentConsistency((hydratedResult.relationArray as MongooseTestDocument[])[index] as MongooseTestDocument, relationArray[index] as CachedLeanDocument<TestModel>);
                runTest((hydratedResult.relationArray as MongooseTestDocument[])[index] as MongooseTestDocument, relationArray[index] as CachedLeanDocument<TestModel>);
            });
        }
    };

    test(`should properly recreate all documents from raw objects and turn them into deep populated documents`, () => {
        prepareHydrateResultsTestCases().forEach(async testCase => {
            const hydratedResult = await hydrateResults<TestModel>(testCase.query, {}, testCase.result as CachedDocument<TestModel>);
            if (isResultWithId(testCase.result)) {
                runTest(hydratedResult as MongooseTestDocument, testCase.result as CachedLeanDocument<TestModel>);
            } else {
                (testCase.result as CachedLeanDocument<TestModel>[]).forEach((result, index) => runTest((hydratedResult as MongooseTestDocument[])[index], result as CachedLeanDocument<TestModel>));
            }
        });
    });
});
