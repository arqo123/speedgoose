import { ObjectId } from 'mongodb';
import Container from 'typedi';
import { GlobalDiContainerRegistryNames } from '../../src/types/types';
import {
    getMongooseInstance,
    getMongooseModelFromDocument,
    getMongooseModelNameFromDocument,
    getValueFromDocument,
    isArrayOfObjectsWithIds,
    isResultWithId,
    isResultWithIds,
    setValueOnDocument,
    getMongooseModelByName,
    isMongooseUnpopulatedField,
} from '../../src/utils/mongooseUtils';
import { generateTestDocument, getMongooseTestModel } from '../testUtils';

describe(`isResultWithId`, () => {
    test(`should be truthy if result is object with key _id`, () => {
        expect(isResultWithId({ _id: 1, fieldA: 'abc', fieldB: 'abcd' })).toBeTruthy();
    });

    test(`should be falsy if result is object without key _id`, () => {
        expect(isResultWithId({ fieldA: 'abc', fieldB: 'abcd' })).toBeFalsy();
    });

    test(`should be falsy if result is not a object`, () => {
        expect(isResultWithId('string')).toBeFalsy();
        expect(isResultWithId(123)).toBeFalsy();
        expect(isResultWithId([])).toBeFalsy();
        expect(isResultWithIds(['123', '_id'])).toBeFalsy();
        expect(isResultWithId(true)).toBeFalsy();
        expect(isResultWithId(false)).toBeFalsy();
        expect(isResultWithId(new Map())).toBeFalsy();
        expect(isResultWithId(new Set())).toBeFalsy();
    });
});

describe(`isArrayOfObjectsWithIds`, () => {
    test(`should be truthy if first element in is object with key _id`, () => {
        expect(isArrayOfObjectsWithIds([{ _id: 1, fieldA: 'abc', fieldB: 'abcd' }])).toBeTruthy();
    });

    test(`should be falsy if first element in is object without key _id`, () => {
        expect(isArrayOfObjectsWithIds([{ fieldA: 'abc', fieldB: 'abcd' }])).toBeFalsy();
    });

    test(`should be falsy if result is not a object`, () => {
        expect(isArrayOfObjectsWithIds('string')).toBeFalsy();
        expect(isArrayOfObjectsWithIds(123)).toBeFalsy();
        expect(isArrayOfObjectsWithIds([])).toBeFalsy();
        expect(isResultWithIds(['123', '_id'])).toBeFalsy();
        expect(isArrayOfObjectsWithIds(true)).toBeFalsy();
        expect(isArrayOfObjectsWithIds(false)).toBeFalsy();
        expect(isArrayOfObjectsWithIds(new Map())).toBeFalsy();
        expect(isArrayOfObjectsWithIds(new Set())).toBeFalsy();
    });
});

describe(`isResultWithIds`, () => {
    test(`should be truthy if first element in is object with key _id or array of objects with _id key`, () => {
        expect(isResultWithIds([{ _id: 1, fieldA: 'abc', fieldB: 'abcd' }])).toBeTruthy();
        expect(isResultWithIds({ _id: 1, fieldA: 'abc', fieldB: 'abcd' })).toBeTruthy();
    });

    test(`should be falsy if first element in is object without key _id or array of objects without _id key`, () => {
        expect(isResultWithIds([{ fieldA: 'abc', fieldB: 'abcd' }])).toBeFalsy();
        expect(isResultWithIds({ fieldA: 'abc', fieldB: 'abcd' })).toBeFalsy();
    });

    test(`should be falsy if result is not a object`, () => {
        expect(isResultWithIds('string')).toBeFalsy();
        expect(isResultWithIds(123)).toBeFalsy();
        expect(isResultWithIds([])).toBeFalsy();
        expect(isResultWithIds(['123', '_id'])).toBeFalsy();
        expect(isResultWithIds(true)).toBeFalsy();
        expect(isResultWithIds(false)).toBeFalsy();
        expect(isResultWithIds(new Map())).toBeFalsy();
        expect(isResultWithIds(new Set())).toBeFalsy();
    });
});

describe(`getValueFromDocument`, () => {
    test(`should return value from root of object, and nested paths`, () => {
        const TestModel = getMongooseTestModel();

        const testDocument = new TestModel({
            fieldA: {
                b: {
                    c: 123,
                },
                d: 456,
                e: [{ f: 'nestedObjectInArrayValue' }, { f: 'someSecondObjectInArray' }, { f: 'thirdObject' }],
            },
            fieldB: 789,
        });

        expect(getValueFromDocument('fieldA.b.c', testDocument)).toEqual(123);
        expect(getValueFromDocument('fieldA.d', testDocument)).toEqual(456);
        expect(getValueFromDocument('fieldA.e[0].f', testDocument)).toEqual('nestedObjectInArrayValue');
        expect(getValueFromDocument('fieldA.e.f', testDocument)).toEqual(['nestedObjectInArrayValue', 'someSecondObjectInArray', 'thirdObject']);
        expect(getValueFromDocument('fieldB', testDocument)).toEqual(789);
    });
});

describe(`setValueOnDocument`, () => {
    test(`should set value on root of object, and nested paths`, () => {
        const TestModel = getMongooseTestModel();

        const testDocument = new TestModel({
            fieldA: {
                b: {
                    c: 123,
                },
                e: [{ f: 'nestedObjectInArrayValue' }],
            },
        });

        setValueOnDocument('fieldA.b.c', 453, testDocument);
        setValueOnDocument('fieldA.b.edf', 'someNewValue', testDocument);
        setValueOnDocument('fieldA.e.1', { f: 'pushedElement' }, testDocument);
        setValueOnDocument('fieldB', 'valueX', testDocument);

        expect(testDocument.toObject()).toMatchObject({
            fieldA: {
                b: {
                    c: 453,
                    edf: 'someNewValue',
                },
                e: [{ f: 'nestedObjectInArrayValue' }, { f: 'pushedElement' }],
            },
            fieldB: 'valueX',
        });
    });
});

describe(`getMongooseModelNameFromDocument`, () => {
    test(`should return proper model name from mongoose document`, () => {
        const TestModel = getMongooseTestModel();
        const testDocument = new TestModel({});

        expect(getMongooseModelNameFromDocument(testDocument)).toEqual('testModel');
    });

    test(`returned model name should be registered in mongoose instance`, () => {
        const TestModel = getMongooseTestModel();
        const testDocument = new TestModel({});

        const modelName = getMongooseModelNameFromDocument(testDocument);
        const mongoose = getMongooseInstance();
        expect(Object.keys(mongoose.models)).toContain(modelName);
    });
});

describe(`getMongooseModelFromDocument`, () => {
    test(`should return proper model from mongoose document`, () => {
        const TestModel = getMongooseTestModel();
        const testDocument = new TestModel({});
        const result = getMongooseModelFromDocument(testDocument);
        expect(result).toBeInstanceOf(Object);
        expect(result.modelName).toEqual('testModel');
    });

    test(`should be falsy if there is no mongoose instance registered in di container`, () => {
        Container.remove(GlobalDiContainerRegistryNames.MONGOOSE_GLOBAL_ACCESS);
        const TestModel = getMongooseTestModel();
        const testDocument = new TestModel({});
        const result = getMongooseModelFromDocument(testDocument);
        expect(result).toBeFalsy();
    });
});

describe(`getMongooseModelByName`, () => {
    test(`should return proper model by its name`, () => {
        const result = getMongooseModelByName('testModel');

        expect(result).toBeInstanceOf(Object);
        expect(result.modelName).toEqual('testModel');
    });

    test(`should be falsy if there is no mongoose instance registered in di container`, () => {
        Container.remove(GlobalDiContainerRegistryNames.MONGOOSE_GLOBAL_ACCESS);
        const result = getMongooseModelByName('testModel');
        expect(result).toBeFalsy();
    });
});

describe(`getMongooseInstance`, () => {
    test(`should return mongoose instance`, () => {
        const mongoose = getMongooseInstance();
        expect(mongoose).toBeInstanceOf(Object);
        expect(Object.keys(mongoose)).toContain('models');
    });
});

describe(`isMongooseUnpopulatedField`, () => {
    test(`should return true if the entry is mongooseId`, () => {
        expect(isMongooseUnpopulatedField(generateTestDocument({ relationField: new ObjectId() }), 'relationField')).toBeTruthy();
    });

    test(`should return true if the entry is stringified MongooseId`, () => {
        expect(isMongooseUnpopulatedField(generateTestDocument({ relationField: String(new ObjectId()) }), 'relationField')).toBeTruthy();
    });

    test(`should return true if the entry is array of mongoose Ids`, () => {
        expect(isMongooseUnpopulatedField(generateTestDocument({ relationArray: [new ObjectId(), new ObjectId()] }), 'relationArray')).toBeTruthy();
    });

    test(`should return true if the entry is array of stringified MongooseIds`, () => {
        expect(isMongooseUnpopulatedField(generateTestDocument({ relationArray: [String(new ObjectId()), String(new ObjectId())] }), 'relationArray')).toBeTruthy();
    });

    test(`should return false if the entry is not an id`, () => {
        expect(isMongooseUnpopulatedField(generateTestDocument({ relationArray: [generateTestDocument({})] }), 'relationArray')).toBeFalsy();
        expect(isMongooseUnpopulatedField(generateTestDocument({ relationField: generateTestDocument({}) }), 'relationField')).toBeFalsy();
        expect(isMongooseUnpopulatedField(generateTestDocument({ relationField: null }), 'relationField')).toBeFalsy();
    });
});
