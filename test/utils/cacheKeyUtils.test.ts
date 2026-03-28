import { ObjectId } from 'mongodb';
import { CachedDocument } from '../../src/types/types';
import { generateCacheKeyForModelName, generateCacheKeyForRecordAndModelName, generateCacheKeyForSingleDocument, generateCacheKeyFromPipeline, generateCacheKeyFromQuery, stableSerialize } from '../../src/utils/cacheKeyUtils';
import * as commonUtils from '../../src/utils/commonUtils';
import { generateCacheKeyForRecordAndModelNameTestData, generateCacheKeyForSingleDocumentTestData } from '../assets/utils/cacheKeyUtils';
import { generateTestAggregate, getMongooseTestModel } from '../testUtils';
import { TestModel } from '../types';

const mockedGetConfig = jest.spyOn(commonUtils, 'getConfig');

/** Creates a minimal object that satisfies Mongoose document detection ($__ + _id). */
const createMockMongooseDoc = (id: ObjectId, fields: Record<string, unknown> = {}) => ({
    _id: id,
    $__: { activePaths: {}, strictMode: true },
    $isNew: false,
    ...fields,
});

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

describe(`stableSerialize — Mongoose document sanitization`, () => {
    test(`should reduce a Mongoose document to its _id ObjectId`, () => {
        const id = new ObjectId();
        const doc = createMockMongooseDoc(id, { name: 'Alice', email: 'a@b.com' });

        const result = stableSerialize({ _id: doc });
        const expected = stableSerialize({ _id: id });

        expect(result).toEqual(expected);
    });

    test(`should reduce a populated Mongoose document with large nested data to its _id`, () => {
        const parentId = new ObjectId();
        const childId = new ObjectId();

        const childDoc = createMockMongooseDoc(childId, {
            name: 'Child',
            hugeArray: Array.from({ length: 1000 }, (_, i) => ({ index: i, data: 'x'.repeat(100) })),
        });

        const parentDoc = createMockMongooseDoc(parentId, {
            name: 'Parent',
            child: childDoc,
        });

        const result = stableSerialize({ _id: parentDoc });
        const expected = stableSerialize({ _id: parentId });

        expect(result).toEqual(expected);
    });

    test(`should reduce Mongoose documents inside $in arrays`, () => {
        const id1 = new ObjectId();
        const id2 = new ObjectId();
        const doc1 = createMockMongooseDoc(id1, { name: 'A' });
        const doc2 = createMockMongooseDoc(id2, { name: 'B' });

        const result = stableSerialize({ _id: { $in: [doc1, doc2] } });
        const expected = stableSerialize({ _id: { $in: [id1, id2] } });

        expect(result).toEqual(expected);
    });

    test(`should produce identical cache keys for findById with ObjectId vs populated document`, () => {
        const model = getMongooseTestModel();
        const id = new ObjectId();

        const queryWithId = model.findOne({ _id: id });
        const queryWithDoc = model.findOne({ _id: createMockMongooseDoc(id, { name: 'Test', nested: { deep: 'value' } }) });

        const keyWithId = generateCacheKeyFromQuery(queryWithId as any);
        const keyWithDoc = generateCacheKeyFromQuery(queryWithDoc as any);

        expect(keyWithDoc).toEqual(keyWithId);
    });

    test(`should handle Mongoose document with string _id`, () => {
        const doc = createMockMongooseDoc('custom-string-id' as any, { name: 'StringIdDoc' });

        const result = stableSerialize({ _id: doc });
        const expected = stableSerialize({ _id: 'custom-string-id' });

        expect(result).toEqual(expected);
    });

    test(`should not affect plain objects that lack $__`, () => {
        const plainObj = { _id: new ObjectId(), name: 'NotADoc' };

        const result = stableSerialize({ filter: plainObj });

        expect(result).toContain('name');
        expect(result).toContain('NotADoc');
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
