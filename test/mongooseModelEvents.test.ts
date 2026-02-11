import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';
import { MongooseDocumentEvents, CacheNamespaces } from '../src/types/types';
import * as cacheClientUtils from '../src/utils/cacheClientUtils';
import * as commonUtils from '../src/utils/commonUtils';
import * as debugUtils from '../src/utils/debugUtils';
import { registerListenerForInternalEvents } from '../src/mongooseModelEvents';
import { getMongooseTestModel, clearTestEventListeners } from './testUtils';
import { TEST_MODEL_NAME } from './constants';

const mockedClearCacheForRecordId = jest.spyOn(cacheClientUtils, 'clearCacheForRecordId');
const mockedGetCacheStrategyInstance = jest.spyOn(commonUtils, 'getCacheStrategyInstance');
const mockedGetDebugger = jest.spyOn(debugUtils, 'getDebugger');

beforeEach(() => {
    jest.clearAllMocks();
});

afterEach(() => {
    clearTestEventListeners();
});

describe('registerListenerForInternalEvents', () => {
    it('should register listeners on all models for both event types', () => {
        const testModel = getMongooseTestModel();
        const onSpy = jest.spyOn(testModel, 'on');

        registerListenerForInternalEvents(mongoose);

        const registeredEvents = onSpy.mock.calls.map(call => call[0]);
        expect(registeredEvents).toContain(MongooseDocumentEvents.SINGLE_DOCUMENT_CHANGED);
        expect(registeredEvents).toContain(MongooseDocumentEvents.MANY_DOCUMENTS_CHANGED);

        onSpy.mockRestore();
    });

    it('should handle mongoose with no models gracefully', () => {
        const emptyMongoose = { models: {} } as unknown as mongoose.Mongoose;
        expect(() => registerListenerForInternalEvents(emptyMongoose)).not.toThrow();
    });

    it('should handle null models gracefully', () => {
        const nullMongoose = { models: null } as unknown as mongoose.Mongoose;
        expect(() => registerListenerForInternalEvents(nullMongoose)).not.toThrow();
    });
});

describe('SINGLE_DOCUMENT_CHANGED event', () => {
    it('should clear cache for the record ID when emitted', async () => {
        const testModel = getMongooseTestModel();
        const recordId = new ObjectId().toString();

        const clearResultsCacheWithSetSpy = jest.fn().mockResolvedValue(undefined);
        mockedGetCacheStrategyInstance.mockReturnValue({
            clearResultsCacheWithSet: clearResultsCacheWithSetSpy,
        } as any);

        mockedClearCacheForRecordId.mockResolvedValue(undefined);

        testModel.emit(MongooseDocumentEvents.SINGLE_DOCUMENT_CHANGED, {
            record: { _id: recordId },
            modelName: TEST_MODEL_NAME,
            wasNew: false,
            wasDeleted: false,
        });

        // Allow async event handlers to complete
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(mockedClearCacheForRecordId).toHaveBeenCalledWith(recordId);
    });

    it('should clear model cache when wasNew is true', async () => {
        const testModel = getMongooseTestModel();
        const recordId = new ObjectId().toString();

        const clearResultsCacheWithSetSpy = jest.fn().mockResolvedValue(undefined);
        mockedGetCacheStrategyInstance.mockReturnValue({
            clearResultsCacheWithSet: clearResultsCacheWithSetSpy,
        } as any);

        mockedClearCacheForRecordId.mockResolvedValue(undefined);

        testModel.emit(MongooseDocumentEvents.SINGLE_DOCUMENT_CHANGED, {
            record: { _id: recordId },
            modelName: TEST_MODEL_NAME,
            wasNew: true,
            wasDeleted: false,
        });

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(mockedClearCacheForRecordId).toHaveBeenCalledWith(recordId);
        expect(clearResultsCacheWithSetSpy).toHaveBeenCalledWith(`${TEST_MODEL_NAME}_`);
    });

    it('should clear model cache when wasDeleted is true', async () => {
        const testModel = getMongooseTestModel();
        const recordId = new ObjectId().toString();

        const clearResultsCacheWithSetSpy = jest.fn().mockResolvedValue(undefined);
        mockedGetCacheStrategyInstance.mockReturnValue({
            clearResultsCacheWithSet: clearResultsCacheWithSetSpy,
        } as any);

        mockedClearCacheForRecordId.mockResolvedValue(undefined);

        testModel.emit(MongooseDocumentEvents.SINGLE_DOCUMENT_CHANGED, {
            record: { _id: recordId },
            modelName: TEST_MODEL_NAME,
            wasNew: false,
            wasDeleted: true,
        });

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(mockedClearCacheForRecordId).toHaveBeenCalledWith(recordId);
        expect(clearResultsCacheWithSetSpy).toHaveBeenCalledWith(`${TEST_MODEL_NAME}_`);
    });

    it('should NOT clear model cache for simple updates (wasNew=false, wasDeleted=false)', async () => {
        const testModel = getMongooseTestModel();
        const recordId = new ObjectId().toString();

        const clearResultsCacheWithSetSpy = jest.fn().mockResolvedValue(undefined);
        mockedGetCacheStrategyInstance.mockReturnValue({
            clearResultsCacheWithSet: clearResultsCacheWithSetSpy,
        } as any);

        mockedClearCacheForRecordId.mockResolvedValue(undefined);

        testModel.emit(MongooseDocumentEvents.SINGLE_DOCUMENT_CHANGED, {
            record: { _id: recordId },
            modelName: TEST_MODEL_NAME,
            wasNew: false,
            wasDeleted: false,
        });

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(mockedClearCacheForRecordId).toHaveBeenCalledWith(recordId);
        // clearResultsCacheWithSet should NOT have been called for model cache
        // (it may be called inside clearCacheForRecordId, but we mocked that)
        expect(clearResultsCacheWithSetSpy).not.toHaveBeenCalled();
    });
});

describe('MANY_DOCUMENTS_CHANGED event', () => {
    it('should clear cache for each record in the batch', async () => {
        const testModel = getMongooseTestModel();
        const recordId1 = new ObjectId().toString();
        const recordId2 = new ObjectId().toString();
        const recordId3 = new ObjectId().toString();

        const clearResultsCacheWithSetSpy = jest.fn().mockResolvedValue(undefined);
        mockedGetCacheStrategyInstance.mockReturnValue({
            clearResultsCacheWithSet: clearResultsCacheWithSetSpy,
        } as any);

        mockedClearCacheForRecordId.mockResolvedValue(undefined);

        testModel.emit(MongooseDocumentEvents.MANY_DOCUMENTS_CHANGED, {
            records: [{ _id: recordId1 }, { _id: recordId2 }, { _id: recordId3 }],
            modelName: TEST_MODEL_NAME,
            wasDeleted: false,
        });

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(mockedClearCacheForRecordId).toHaveBeenCalledTimes(3);
        expect(mockedClearCacheForRecordId).toHaveBeenCalledWith(recordId1);
        expect(mockedClearCacheForRecordId).toHaveBeenCalledWith(recordId2);
        expect(mockedClearCacheForRecordId).toHaveBeenCalledWith(recordId3);
    });

    it('should clear model cache when wasDeleted is true', async () => {
        const testModel = getMongooseTestModel();
        const recordId1 = new ObjectId().toString();
        const recordId2 = new ObjectId().toString();

        const clearResultsCacheWithSetSpy = jest.fn().mockResolvedValue(undefined);
        mockedGetCacheStrategyInstance.mockReturnValue({
            clearResultsCacheWithSet: clearResultsCacheWithSetSpy,
        } as any);

        mockedClearCacheForRecordId.mockResolvedValue(undefined);

        testModel.emit(MongooseDocumentEvents.MANY_DOCUMENTS_CHANGED, {
            records: [{ _id: recordId1 }, { _id: recordId2 }],
            modelName: TEST_MODEL_NAME,
            wasDeleted: true,
        });

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(mockedClearCacheForRecordId).toHaveBeenCalledTimes(2);
        // Model cache should be cleared for each record since wasDeleted is true
        expect(clearResultsCacheWithSetSpy).toHaveBeenCalledWith(`${TEST_MODEL_NAME}_`);
    });

    it('should process all records in parallel', async () => {
        const testModel = getMongooseTestModel();
        const callOrder: string[] = [];

        mockedClearCacheForRecordId.mockImplementation(async (recordId: string) => {
            callOrder.push(recordId);
            return undefined;
        });

        const clearResultsCacheWithSetSpy = jest.fn().mockResolvedValue(undefined);
        mockedGetCacheStrategyInstance.mockReturnValue({
            clearResultsCacheWithSet: clearResultsCacheWithSetSpy,
        } as any);

        const recordId1 = new ObjectId().toString();
        const recordId2 = new ObjectId().toString();

        testModel.emit(MongooseDocumentEvents.MANY_DOCUMENTS_CHANGED, {
            records: [{ _id: recordId1 }, { _id: recordId2 }],
            modelName: TEST_MODEL_NAME,
            wasDeleted: false,
        });

        await new Promise(resolve => setTimeout(resolve, 50));

        // Both records should have been processed
        expect(callOrder).toContain(recordId1);
        expect(callOrder).toContain(recordId2);
        expect(callOrder).toHaveLength(2);
    });
});

describe('prepareDocumentEventContext', () => {
    it('should set up debugger on context for SINGLE_DOCUMENT_CHANGED', async () => {
        const testModel = getMongooseTestModel();
        const recordId = new ObjectId().toString();

        mockedClearCacheForRecordId.mockResolvedValue(undefined);
        const clearResultsCacheWithSetSpy = jest.fn().mockResolvedValue(undefined);
        mockedGetCacheStrategyInstance.mockReturnValue({
            clearResultsCacheWithSet: clearResultsCacheWithSetSpy,
        } as any);

        testModel.emit(MongooseDocumentEvents.SINGLE_DOCUMENT_CHANGED, {
            record: { _id: recordId },
            modelName: TEST_MODEL_NAME,
            wasNew: false,
            wasDeleted: false,
        });

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(mockedGetDebugger).toHaveBeenCalledWith(TEST_MODEL_NAME, 'event');
    });

    it('should set up debugger on context for MANY_DOCUMENTS_CHANGED', async () => {
        const testModel = getMongooseTestModel();
        const recordId = new ObjectId().toString();

        mockedClearCacheForRecordId.mockResolvedValue(undefined);
        const clearResultsCacheWithSetSpy = jest.fn().mockResolvedValue(undefined);
        mockedGetCacheStrategyInstance.mockReturnValue({
            clearResultsCacheWithSet: clearResultsCacheWithSetSpy,
        } as any);

        testModel.emit(MongooseDocumentEvents.MANY_DOCUMENTS_CHANGED, {
            records: [{ _id: recordId }],
            modelName: TEST_MODEL_NAME,
            wasDeleted: false,
        });

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(mockedGetDebugger).toHaveBeenCalledWith(TEST_MODEL_NAME, 'event');
    });
});

describe('Integration with caching', () => {
    beforeEach(() => {
        // Restore mocks so real cache strategy is used
        mockedClearCacheForRecordId.mockRestore();
        mockedGetCacheStrategyInstance.mockRestore();
    });

    it('should clear cache when SINGLE_DOCUMENT_CHANGED is emitted for a cached query', async () => {
        const testModel = getMongooseTestModel();
        const strategy = commonUtils.getCacheStrategyInstance();
        const cacheKey = 'integration_single_test_key';
        const recordId = new ObjectId().toString();

        // Manually put something in the cache
        await strategy.addValueToCache(CacheNamespaces.RESULTS_NAMESPACE, cacheKey, { name: 'cached_result' });
        await strategy.addValueToManyCachedSets([recordId], cacheKey);

        // Verify it is cached
        const cachedBefore = await strategy.getValueFromCache(CacheNamespaces.RESULTS_NAMESPACE, cacheKey);
        expect(cachedBefore).toEqual({ name: 'cached_result' });

        // Emit the event
        testModel.emit(MongooseDocumentEvents.SINGLE_DOCUMENT_CHANGED, {
            record: { _id: recordId },
            modelName: TEST_MODEL_NAME,
            wasNew: false,
            wasDeleted: false,
        });

        await new Promise(resolve => setTimeout(resolve, 100));

        // Verify cache was cleared
        const cachedAfter = await strategy.getValueFromCache(CacheNamespaces.RESULTS_NAMESPACE, cacheKey);
        expect(cachedAfter).toBeNull();
    });

    it('should clear cache when MANY_DOCUMENTS_CHANGED is emitted for cached queries', async () => {
        const testModel = getMongooseTestModel();
        const strategy = commonUtils.getCacheStrategyInstance();
        const cacheKey1 = 'integration_many_test_key_1';
        const cacheKey2 = 'integration_many_test_key_2';
        const recordId1 = new ObjectId().toString();
        const recordId2 = new ObjectId().toString();

        // Manually put something in the cache
        await strategy.addValueToCache(CacheNamespaces.RESULTS_NAMESPACE, cacheKey1, { name: 'cached_result_1' });
        await strategy.addValueToManyCachedSets([recordId1], cacheKey1);
        await strategy.addValueToCache(CacheNamespaces.RESULTS_NAMESPACE, cacheKey2, { name: 'cached_result_2' });
        await strategy.addValueToManyCachedSets([recordId2], cacheKey2);

        // Verify they are cached
        expect(await strategy.getValueFromCache(CacheNamespaces.RESULTS_NAMESPACE, cacheKey1)).toEqual({ name: 'cached_result_1' });
        expect(await strategy.getValueFromCache(CacheNamespaces.RESULTS_NAMESPACE, cacheKey2)).toEqual({ name: 'cached_result_2' });

        // Emit the event
        testModel.emit(MongooseDocumentEvents.MANY_DOCUMENTS_CHANGED, {
            records: [{ _id: recordId1 }, { _id: recordId2 }],
            modelName: TEST_MODEL_NAME,
            wasDeleted: false,
        });

        await new Promise(resolve => setTimeout(resolve, 100));

        // Verify caches were cleared
        expect(await strategy.getValueFromCache(CacheNamespaces.RESULTS_NAMESPACE, cacheKey1)).toBeNull();
        expect(await strategy.getValueFromCache(CacheNamespaces.RESULTS_NAMESPACE, cacheKey2)).toBeNull();
    });
});
