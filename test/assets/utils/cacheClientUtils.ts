import { CachedDocument, CachedResult, SpeedGooseCacheOperationContext } from '../../../src/types/types';
import { emptyDebugCallback } from '../../../src/utils/debugUtils';
import { generateTestDocument, getMongooseTestModel } from '../../testUtils';
import { MongooseTestModel, TestModel } from '../../types';

export type SetKeyInResultsCachesTestData = {
    context: SpeedGooseCacheOperationContext;
    result: CachedResult<unknown>;
    model: MongooseTestModel;
};

export const cachingTestCases = [
    { value: { obj: 'a', set: new Set() }, key: 'object' },
    { value: 'string', key: 'string' },
    { value: 123, key: 'number' },
    { value: ['someArray'], key: 'array' },
    { value: new Map(), key: 'map' },
];

export const generateClearResultTestCase = () => ({
    modelName: 'modelName',
    multitenantValue: 'multitenantValue',
    cacheQueryKey: 'cacheQueryKey',
    key: 'recordId',
    value: generateTestDocument({ name: 'testDocument' }),
});

export const generateSetKeyInResultsCachesTestData = (): SetKeyInResultsCachesTestData[] => [
    // tc01  -  ttl set
    {
        context: {
            ttl: 120,
            cacheKey: 'cacheKeyTc01',
            debug: emptyDebugCallback,
        },
        result: { key: 'cachedResutl' },
        model: getMongooseTestModel(),
    },
    // tc02 - ttl set , mongoose document with Id
    {
        context: {
            ttl: 120,
            cacheKey: 'cacheKeyTc02',
            debug: emptyDebugCallback,
        },
        result: generateTestDocument({ name: 'tc02' }),
        model: getMongooseTestModel(),
    },
    // tc03 - ttl set , array of documents
    {
        context: {
            ttl: 90,
            cacheKey: 'cacheKeyTc03',
            debug: emptyDebugCallback,
        },
        result: [generateTestDocument({ name: 'tc03a' }), generateTestDocument({ name: 'tc03b' }), generateTestDocument({ name: 'tc03c' })] as CachedDocument<TestModel>[],
        model: getMongooseTestModel(),
    },
];
