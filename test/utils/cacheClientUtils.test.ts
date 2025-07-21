import { ObjectId } from 'mongodb';
import Keyv from 'keyv';
import { CachedResult, CacheNamespaces, CacheStrategiesTypes, SpeedGooseCacheOperationContext } from '../../src/types/types';
import * as cacheClientUtils from '../../src/utils/cacheClientUtils';
import * as debugUtils from '../../src/utils/debugUtils';
import { getCacheStrategyInstance, objectDeserializer, objectSerializer } from '../../src/utils/commonUtils';
import { cachingTestCases, generateClearResultTestCase, generateSetKeyInResultsCachesTestData, SetKeyInResultsCachesTestData } from '../assets/utils/cacheClientUtils';
import { generateTestDocument, getMongooseTestModel, getValuesFromSet } from '../testUtils';
import * as commonUtils from '../../src/utils/commonUtils';
import { clearCacheForKey, refreshTTLTimeIfNeeded } from '../../src/utils/cacheClientUtils';
import { generateCacheKeyForModelName } from '../../src/utils/cacheKeyUtils';
// TestModel is already imported via getMongooseTestModel
import { TestModel } from '../types';
import * as queueUtils from '../../src/utils/queueUtils';
import { isResultWithId, isResultWithIds } from '../../src/utils/mongooseUtils';
import mongoose from 'mongoose';


const mockedGetHydrationCache = jest.spyOn(commonUtils, 'getHydrationCache');
const mockedAddValueToInternalCachedSet = jest.spyOn(cacheClientUtils, 'addValueToInternalCachedSet');
const mockedLogCacheClear = jest.spyOn(debugUtils, 'logCacheClear');
const mockedScheduleTTlRefreshing = jest.spyOn(queueUtils, 'scheduleTTlRefreshing');

beforeEach(() => {
    jest.useFakeTimers();
});

describe('createInMemoryCacheClientWithNamespace', () => {
    const cacheClient = cacheClientUtils.createInMemoryCacheClientWithNamespace('testNamespace');

    test(`should return Keyv instance with opts`, () => {
        expect(cacheClient.opts.namespace).toEqual('testNamespace');
        expect(cacheClient.opts.serialize).toEqual(objectSerializer);
        expect(cacheClient.opts.deserialize).toEqual(objectDeserializer);
    });

    test(`should set and return objects as they are - without stringify `, async () => {
        //setting values
        for (const testCase of cachingTestCases) {
            await cacheClient.set(testCase.key, testCase.value);
        }

        for (const testCase of cachingTestCases) {
            expect(await cacheClient.get(testCase.key)).toEqual(testCase.value);
        }
    });
});

describe('getResultsFromCache', () => {
    test(`should set and return objects as they are - without stringify when using getResultsFromCache`, async () => {
        for (const testCase of cachingTestCases) {
            await getCacheStrategyInstance().addValueToCache(CacheNamespaces.RESULTS_NAMESPACE, testCase.key, testCase.value as CachedResult);
        }

        for (const testCase of cachingTestCases) {
            expect(await cacheClientUtils.getResultsFromCache(testCase.key)).toEqual(testCase.value);
        }
    });
});

describe('setKeyInHydrationCaches', () => {
    const id1 = new ObjectId();
    const id2 = new ObjectId();

    const document1 = generateTestDocument({ _id: id1, name: 'testModelName1' });
    const document2 = generateTestDocument({ _id: id2, name: 'testModelName2' });
    const document3 = generateTestDocument({ _id: id1, name: 'testModelName1_withVariation', fieldA: 'fieldA' });

    beforeEach(async () => {
        await cacheClientUtils.setKeyInHydrationCaches('testKey1', document1, {});
        await cacheClientUtils.setKeyInHydrationCaches('testKey2', document2, {});
        await cacheClientUtils.setKeyInHydrationCaches('testKey1_varation', document3, {});
    });

    test(`keys after set should be accessible with the getHydrationCache method`, async () => {
        expect(mockedGetHydrationCache).toBeCalled();
        expect(mockedAddValueToInternalCachedSet).toBeCalled();

        expect(await commonUtils.getHydrationCache().get('testKey1')).toEqual(document1);
        expect(await commonUtils.getHydrationCache().get('testKey2')).toEqual(document2);
        expect(await commonUtils.getHydrationCache().get('testKey1_varation')).toEqual(document3);
    });

    test(`getHydrationVariationsCache should return set with unique keys `, async () => {
        const set1 = (await commonUtils.getHydrationVariationsCache().get(id1.toString())) as Set<string>;
        const set2 = (await commonUtils.getHydrationVariationsCache().get(id2.toString())) as Set<string>;

        expect(getValuesFromSet(set1)).toEqual(['testKey1', 'testKey1_varation'].sort());
        expect(getValuesFromSet(set2)).toEqual(['testKey2'].sort());
    });

    test(`should allow to overwrite keys in hydration cache `, async () => {
        const document4 = generateTestDocument({ _id: id1, name: 'someBrandNewDocumentToOverwrite' });
        await cacheClientUtils.setKeyInHydrationCaches('testKey1', document4, {});

        expect(mockedGetHydrationCache).toBeCalled();
        expect(mockedAddValueToInternalCachedSet).toBeCalled();

        expect(await commonUtils.getHydrationCache().get('testKey1')).not.toEqual(document1);
        expect(await commonUtils.getHydrationCache().get('testKey1')).toEqual(document4);

        const set1 = (await commonUtils.getHydrationVariationsCache().get(id1.toString())) as Set<string>;
        expect(getValuesFromSet(set1)).toEqual(['testKey1', 'testKey1_varation'].sort());
    });
});

describe('addValueToInternalCachedSet', () => {
    const cacheClient: Keyv<Set<string | number>> = cacheClientUtils.createInMemoryCacheClientWithNamespace('testNamespace');

    test(`should create set with first element if does not exists for given key`, async () => {
        await cacheClientUtils.addValueToInternalCachedSet(cacheClient, 'firstNamespace', 'firstValue');
        const set = (await cacheClient.get('firstNamespace')) as Set<string>;

        expect(getValuesFromSet(set)).toEqual(['firstValue']);
    });

    test(`should add next element to exisitng set`, async () => {
        await cacheClientUtils.addValueToInternalCachedSet(cacheClient, 'secondNamespace', 'firstValue');
        await cacheClientUtils.addValueToInternalCachedSet(cacheClient, 'secondNamespace', 'secondValue');

        const set = (await cacheClient.get('secondNamespace')) as Set<string>;

        expect(getValuesFromSet(set)).toEqual(['firstValue', 'secondValue']);
    });

    test(`should prevent parrarel saves into set`, async () => {
        await Promise.all([
            cacheClientUtils.addValueToInternalCachedSet(cacheClient, 'thirdNamepsace', 'firstValue'),
            cacheClientUtils.addValueToInternalCachedSet(cacheClient, 'thirdNamepsace', 'secondValue'),
            cacheClientUtils.addValueToInternalCachedSet(cacheClient, 'thirdNamepsace', 'thirdValue'),
            cacheClientUtils.addValueToInternalCachedSet(cacheClient, 'thirdNamepsace', 'fourthValue'),
            cacheClientUtils.addValueToInternalCachedSet(cacheClient, 'thirdNamepsace', 'fifthValue'),
            cacheClientUtils.addValueToInternalCachedSet(cacheClient, 'thirdNamepsace', 'sixthValue'),
        ]);

        const set = (await cacheClient.get('thirdNamepsace')) as Set<string>;

        expect(getValuesFromSet(set)).toEqual(['firstValue', 'secondValue', 'thirdValue', 'fourthValue', 'fifthValue', 'sixthValue'].sort());
    });
});

describe(`clearCacheForKey`, () => {
    test(`should log informations with debugger`, async () => {
        mockedLogCacheClear.mockClear();
        await clearCacheForKey('testKey');
        expect(mockedLogCacheClear).toBeCalledTimes(1);
        expect(mockedLogCacheClear).toHaveBeenCalledWith(`Clearing results cache for key`, 'testKey');
    });

    test(`should clear cached key from results cache`, async () => {
        const testCase = {
            key: 'magicHat',
            value: 'rabbit',
        };

        const strategy = await getCacheStrategyInstance();
        //setting value to clear
        await strategy.addValueToCache(CacheNamespaces.RESULTS_NAMESPACE, testCase.key, testCase.value);
        //checking if the value is set
        expect(await strategy.getValueFromCache(CacheNamespaces.RESULTS_NAMESPACE, testCase.key)).toEqual(testCase.value);
        //ok rabbit is still there. Lets do some magic
        await clearCacheForKey(testCase.key);
        const cachedValue = await strategy.getValueFromCache(CacheNamespaces.RESULTS_NAMESPACE, testCase.key);
        // expect(cachedValue).not.toEqual(testCase.value)
        expect(cachedValue).toBeUndefined();
    });
});

describe(`clearCacheForRecordId`, () => {
    const testCase = generateClearResultTestCase();

    test(`should log informations with debugger`, async () => {
        mockedLogCacheClear.mockClear();
        await cacheClientUtils.clearCacheForRecordId('recordId');
        expect(mockedLogCacheClear).toBeCalledTimes(2);
        expect(mockedLogCacheClear).toHaveBeenCalledWith(`Clearing results and hydration cache for recordId`, 'recordId');
        expect(mockedLogCacheClear).toHaveBeenCalledWith(`Clearing hydration cache for recordId`, 'recordId');
    });

    test(`should clear hydration cache`, async () => {
        const recordId = String(testCase.value._id);
        const strategy = getCacheStrategyInstance();
        //setting value to clear
        await strategy.addValueToManyCachedSets([recordId], testCase.cacheQueryKey);
        await cacheClientUtils.setKeyInHydrationCaches(testCase.key, testCase.value, { cacheKey: testCase.cacheQueryKey });
        //checking if the value was set
        expect(await commonUtils.getHydrationCache().get(testCase.key)).toEqual(testCase.value);
        expect(await strategy.getValuesFromCachedSet(recordId)).toEqual([testCase.cacheQueryKey]);

        // invoking clearCacheForRecordId
        await cacheClientUtils.clearCacheForRecordId(recordId);

        expect(await commonUtils.getHydrationCache().get(testCase.key)).toBeUndefined();
        expect(await strategy.getValuesFromCachedSet(recordId)).toEqual([]);
    });
});

describe(`clearCachedResultsForModel`, () => {
    const testCase = generateClearResultTestCase();

    const modelCacheKey = generateCacheKeyForModelName(testCase.modelName, testCase.multitenantValue);

    test(`should log informations with debugger`, async () => {
        mockedLogCacheClear.mockClear();
        await cacheClientUtils.clearCachedResultsForModel(testCase.modelName, testCase.multitenantValue);
        expect(mockedLogCacheClear).toBeCalledTimes(1);
        expect(mockedLogCacheClear).toHaveBeenCalledWith(`Clearing model cache for key`, modelCacheKey);
    });

    test(`should clear results for given model`, async () => {
        const strategy = getCacheStrategyInstance();
        //setting value to clear
        await strategy.addValueToManyCachedSets([modelCacheKey], testCase.cacheQueryKey);
        await strategy.addValueToCache(CacheNamespaces.RESULTS_NAMESPACE, testCase.cacheQueryKey, testCase.value);

        //checking if the value was set
        expect(await strategy.getValuesFromCachedSet(modelCacheKey)).toEqual([testCase.cacheQueryKey]);
        expect(await strategy.getValueFromCache(CacheNamespaces.RESULTS_NAMESPACE, testCase.cacheQueryKey)).toEqual(testCase.value);

        await cacheClientUtils.clearCachedResultsForModel(testCase.modelName, testCase.multitenantValue);
        expect(await strategy.getValuesFromCachedSet(modelCacheKey)).toEqual([]);
        expect(await strategy.getValueFromCache(CacheNamespaces.RESULTS_NAMESPACE, testCase.cacheQueryKey)).toBeUndefined();
    });
});

describe(`setKeyInResultsCaches`, () => {
    const testCases = generateSetKeyInResultsCachesTestData();

    beforeEach(async () => {
        for (const testCase of testCases) {
            await cacheClientUtils.setKeyInResultsCaches(testCase.context, testCase.result, testCase.model);
        }
    });

    test(`should call context debuger`, async () => {
        for (const testCase of testCases) {
            const contextSpy = jest.spyOn(testCase.context, 'debug');
            await cacheClientUtils.setKeyInResultsCaches(testCase.context, testCase.result, testCase.model);
            expect(contextSpy).toBeCalledWith(`Setting key in cache`, testCase.context.cacheKey);
            expect(contextSpy).toBeCalledWith(`Cache key set`, testCase.context.cacheKey);
        }
    });

    test(`should addValueToCache with proper params`, async () => {
        const strategy = getCacheStrategyInstance();
        const mockedCacheStrategyInstance = jest.spyOn(strategy, 'addValueToCache');

        for (const testCase of testCases) {
            await cacheClientUtils.setKeyInResultsCaches(testCase.context, testCase.result, testCase.model);
            expect(mockedCacheStrategyInstance).toBeCalledWith(CacheNamespaces.RESULTS_NAMESPACE, testCase.context.cacheKey, testCase.result, testCase.context.ttl);
        }
    });

    test(`should set key in results cache `, async () => {
        const strategy = getCacheStrategyInstance();

        for (const testCase of testCases) {
            const result = await strategy.getValueFromCache(CacheNamespaces.RESULTS_NAMESPACE, testCase.context.cacheKey as string);
            expect(result).toEqual(testCase.result);
        }
    });

    test(`should set key in model cache `, async () => {
        const strategy = getCacheStrategyInstance();
        for (const testCase of testCases) {
            const modelKey = generateCacheKeyForModelName(testCase.model.modelName);
            const result = await strategy.getValuesFromCachedSet(modelKey);
            expect(result).toContain(testCase.context.cacheKey);
        }
    });

    test(`should set key records cache if it contains some documents with ids`, async () => {
        const runTestForResultedRecord = async (singleEntryFromResult: TestModel, wholeResult: TestModel | TestModel[], testCase: SetKeyInResultsCachesTestData, strategy: CacheStrategiesTypes): Promise<void> => {
            const recordsRealatedKeys = await strategy.getValuesFromCachedSet(String(singleEntryFromResult._id));

            for (const relatedKey of recordsRealatedKeys) {
                const cachedResult = await strategy.getValueFromCache(CacheNamespaces.RESULTS_NAMESPACE, relatedKey);
                expect(cachedResult).toEqual(wholeResult);
            }

            expect(recordsRealatedKeys).toContain(testCase.context.cacheKey as string);
        };

        const strategy = getCacheStrategyInstance();
        for (const testCase of testCases) {
            if (isResultWithId(testCase.result)) {
                await runTestForResultedRecord(testCase.result as TestModel, testCase.result as TestModel, testCase, strategy);
            } else if (isResultWithIds(testCase.result)) {
                for (const result of testCase.result as TestModel[]) {
                    await runTestForResultedRecord(result, testCase.result as TestModel[], testCase, strategy);
                }
            }
        }
    });
});


describe('refreshTTLTimeIfNeeded', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should schedule TTL refreshing when refreshTtlOnRead is true', () => {
        const context = <SpeedGooseCacheOperationContext>{ refreshTtlOnRead: true, debug: debugUtils.emptyDebugCallback };
        const cachedValue = {}; // Your CachedResult goes here

        refreshTTLTimeIfNeeded(context, cachedValue);

        // Move timers forward so setTimeout callback is executed
        jest.runAllTimers();

        expect(mockedScheduleTTlRefreshing).toHaveBeenCalledTimes(1);
        expect(mockedScheduleTTlRefreshing).toHaveBeenCalledWith(context, cachedValue);
    });

    it('should not schedule TTL refreshing when refreshTtlOnRead is false', () => {
        const context = <SpeedGooseCacheOperationContext>{ refreshTtlOnRead: false, debug: debugUtils.emptyDebugCallback };
        const cachedValue = {}; // Your CachedResult goes here

        refreshTTLTimeIfNeeded(context, cachedValue);

        // Move timers forward so setTimeout callback is executed
        jest.runAllTimers();

        expect(mockedScheduleTTlRefreshing).not.toHaveBeenCalled();
    });
});



describe(`isCached`, () => {
  it('should return false when key is not cached', async () => {
    const isCached = await cacheClientUtils.isCached('nonExistentKey');
    expect(isCached).toBe(false);
  });

  it('should return true when key is cached', async () => {
    const context = {
      ttl: 120,
      cacheKey: 'cacheKeyTc01',
      debug: debugUtils.emptyDebugCallback,
    };
    
    const result = { key: 'cachedResult' };
    const model = getMongooseTestModel();
    await cacheClientUtils.setKeyInResultsCaches(context, result, model);
    const isCached = await cacheClientUtils.isCached(context.cacheKey);
    expect(isCached).toBe(true);
  });
});

afterEach(() => {
    mongoose.model('User').removeAllListeners();
});
