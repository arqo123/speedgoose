import { CachedDocument } from '../../src/types/types';
import { generateCacheKeyForModelName, generateCacheKeyForRecordAndModelName, generateCacheKeyForSingleDocument, generateCacheKeyFromPipeline, generateCacheKeyFromQuery } from '../../src/utils/cacheKeyUtils';
import * as commonUtils from '../../src/utils/commonUtils';
import { generateCacheKeyForRecordAndModelNameTestData, generateCacheKeyForSingleDocumentTestData } from '../assets/utils/cacheKeyUtils';
import { generateTestAggregate, getMongooseTestModel } from '../testUtils';
import { TestModel } from '../types';

const mockedGetConfig = jest.spyOn(commonUtils, 'getConfig');

describe(`generateCacheKeyForRecordAndModelName`, () => {
    test(`should properly generate key for record and model name `, () => {
        generateCacheKeyForRecordAndModelNameTestData().forEach(testCase => {
            mockedGetConfig.mockReturnValue(testCase.given.config);

            const key = generateCacheKeyForRecordAndModelName(testCase.given.record, testCase.given.modelName);
            expect(key).toEqual(testCase.expected);
        });
    });
});

describe(`generateCacheKeyForModelName`, () => {
    test(`should properly generate key when multitenantValue is in input`, () => {
        expect(generateCacheKeyForModelName('testModelName', 'multitenantValue')).toEqual('testModelName_multitenantValue');
    });

    test(`should properly generate key when multitenantValue is NOT in input`, () => {
        expect(generateCacheKeyForModelName('testModelName')).toEqual('testModelName_');
    });
});

describe(`generateCacheKeyForSingleDocument`, () => {
    test(`should properly generate key for record and model name `, () => {
        generateCacheKeyForSingleDocumentTestData().forEach(testCase => {
            const key = generateCacheKeyForSingleDocument(testCase.given.query, testCase.given.record as CachedDocument<TestModel>);
            expect(key).toEqual(testCase.expected);
        });
    });
});

describe(`generateCacheKeyFromQuery`, () => {
    test(`should generate same key for semantically identical filters with different key order`, () => {
        const model = getMongooseTestModel();
        const firstQuery = model.find({ a: 1, b: 2 });
        const secondQuery = model.find({ b: 2, a: 1 });

        const firstKey = generateCacheKeyFromQuery(firstQuery as any);
        const secondKey = generateCacheKeyFromQuery(secondQuery as any);

        expect(firstKey).toEqual(secondKey);
    });

    test(`should generate different keys for populated and not populated query variants`, () => {
        const model = getMongooseTestModel();
        const plainQuery = model.find({ someField: 'someValue' });
        const populatedQuery = model.find({ someField: 'someValue' }).populate('relationField');

        const plainKey = generateCacheKeyFromQuery(plainQuery as any);
        const populatedKey = generateCacheKeyFromQuery(populatedQuery as any);

        expect(populatedKey).not.toEqual(plainKey);
    });
});

describe(`generateCacheKeyFromPipeline`, () => {
    test(`should generate different keys for the same pipeline with different aggregate options`, () => {
        const pipeline = [{ $match: { someField: 'someValue' } }];
        const firstAggregation = generateTestAggregate(pipeline).option({ allowDiskUse: true, collation: { locale: 'en' } });
        const secondAggregation = generateTestAggregate(pipeline).option({ allowDiskUse: false, collation: { locale: 'en' } });

        const firstKey = generateCacheKeyFromPipeline(firstAggregation as any);
        const secondKey = generateCacheKeyFromPipeline(secondAggregation as any);

        expect(firstKey).not.toEqual(secondKey);
    });

    test(`should generate same key when aggregate options have different key order`, () => {
        const pipeline = [{ $match: { someField: 'someValue' } }];
        const firstAggregation = generateTestAggregate(pipeline).option({ allowDiskUse: true, collation: { locale: 'en', strength: 2 } });
        const secondAggregation = generateTestAggregate(pipeline).option({ collation: { strength: 2, locale: 'en' }, allowDiskUse: true });

        const firstKey = generateCacheKeyFromPipeline(firstAggregation as any);
        const secondKey = generateCacheKeyFromPipeline(secondAggregation as any);

        expect(firstKey).toEqual(secondKey);
    });
});
