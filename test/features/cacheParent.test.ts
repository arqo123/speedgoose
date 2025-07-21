import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';
import { CacheNamespaces } from '../../src/types/types';
import * as cacheClientUtils from '../../src/utils/cacheClientUtils';
import * as commonUtils from '../../src/utils/commonUtils';
import * as mongooseUtils from '../../src/utils/mongooseUtils';
import { clearTestCache } from '../testUtils';
import { applySpeedGooseCacheLayer } from '../../src/wrapper';
import { CacheStrategiesTypes } from '../../src/types/types';

describe('clearParentCache', () => {
    const mockDocId = new ObjectId();
    const mockDoc = {
        _id: mockDocId,
        modelName: 'TestModel',
        toObject: () => ({ _id: mockDocId, modelName: 'TestModel' })
    };
    const mockParentIds = Array.from({ length: 30 }, (_, i) => `ParentModel:${new ObjectId()}`);
    let mockCacheStrategy: CacheStrategiesTypes;

    beforeAll(() => {
        applySpeedGooseCacheLayer(mongoose, {});
    });

    beforeEach(async () => {
        jest.useFakeTimers({
            legacyFakeTimers: false,
            doNotFake: ['nextTick', 'setImmediate']
        });
        
        mockCacheStrategy = {
            getParentsOfChild: jest.fn().mockResolvedValue(mockParentIds),
            removeChildRelationships: jest.fn().mockResolvedValue(undefined),
            addValueToCache: jest.fn().mockResolvedValue(undefined),
            getValueFromCache: jest.fn().mockResolvedValue(undefined),
            addValueToCacheSet: jest.fn().mockResolvedValue(undefined),
            getValuesFromCachedSet: jest.fn().mockResolvedValue([]),
            clearResultsCacheWithSet: jest.fn().mockResolvedValue(undefined),
            isValueCached: jest.fn().mockResolvedValue(false),
            removeKeyForCache: jest.fn().mockResolvedValue(undefined),
            addValueToManyCachedSets: jest.fn().mockResolvedValue(undefined)
        } as unknown as CacheStrategiesTypes;
        
        jest.spyOn(commonUtils, 'getCacheStrategyInstance').mockReturnValue(mockCacheStrategy);
        jest.spyOn(mongooseUtils, 'getMongooseModelNameFromDocument').mockReturnValue('TestModel');
        jest.spyOn(cacheClientUtils, 'clearCacheForRecordId').mockResolvedValue(undefined);
        
        delete mongoose.models.TestModel;
        delete mongoose.models.Friend;
        await clearTestCache();
        
        applySpeedGooseCacheLayer(mongoose, {});
    });

    afterEach(async () => {
        await clearTestCache();
        jest.runAllTimers();
        jest.useRealTimers();
        jest.clearAllMocks();
        jest.restoreAllMocks();
        delete process.env.CACHE_PARENT_LIMIT;
        jest.restoreAllMocks();
        jest.clearAllMocks();
    });

    afterAll(async () => {
        await mongoose.disconnect();
    });

    it('should process parents in batches of 25 with 10ms delays', async () => {
        const clearParentPromise = cacheClientUtils.clearParentCache(mockDoc as any);
        
        const batchCount = Math.ceil(30 / 25);
        for (let i = 0; i < batchCount; i++) {
            await jest.advanceTimersByTimeAsync(10);
            await jest.runAllTicks();
            await new Promise(setImmediate);
        }
        await clearParentPromise;
        
        expect(cacheClientUtils.clearCacheForRecordId).toHaveBeenCalledTimes(30);
        expect(mockCacheStrategy.removeChildRelationships).toHaveBeenCalledWith(
            `${CacheNamespaces.RELATIONS_CHILD_TO_PARENT}:TestModel:${mockDoc._id}`
        );
    }, 30000);

    it('should respect valid CACHE_PARENT_LIMIT environment variable', async () => {
        applySpeedGooseCacheLayer(mongoose, {
            cacheParentLimit: 15
        });
        const clearParentPromise = cacheClientUtils.clearParentCache(mockDoc as any);
        
        const batchCount = Math.ceil(15 / 25); // Use the limit value instead of full array length
        for (let i = 0; i < batchCount; i++) {
            await jest.advanceTimersByTimeAsync(10);
            await jest.runAllTicks();
            await new Promise(setImmediate);
        }
        await clearParentPromise;
        
        expect(cacheClientUtils.clearCacheForRecordId).toHaveBeenCalledTimes(15);
        expect(mockCacheStrategy.removeChildRelationships).toHaveBeenCalledTimes(1);
    }, 30000);

    it('should clean up child relationships after processing', async () => {
        process.env.CACHE_PARENT_LIMIT = 'invalid';
        const clearParentPromise = cacheClientUtils.clearParentCache(mockDoc as any);
        
        const batchCount = Math.ceil(30 / 25);
        for (let i = 0; i < batchCount; i++) {
            await jest.advanceTimersByTimeAsync(10);
            await jest.runAllTicks();
            await new Promise(setImmediate);
        }
        await clearParentPromise;
        
        expect(cacheClientUtils.clearCacheForRecordId).toHaveBeenCalledTimes(30);
        expect(mockCacheStrategy.removeChildRelationships).toHaveBeenCalledTimes(1);
    }, 30000);

    it('should handle invalid config value correctly', async () => {
        applySpeedGooseCacheLayer(mongoose, {
            cacheParentLimit: NaN
        });
        
        // Refresh mocks after reconfiguration
        jest.spyOn(commonUtils, 'getCacheStrategyInstance').mockReturnValue(mockCacheStrategy);
        jest.spyOn(cacheClientUtils, 'clearCacheForRecordId').mockResolvedValue(undefined);

        const clearParentPromise = cacheClientUtils.clearParentCache(mockDoc as any);
        
        // Process batches using default limit of 100 (30 parents / 100 = 1 batch)
        const batchCount = Math.ceil(30 / 100);
        for (let i = 0; i < batchCount; i++) {
            await jest.advanceTimersByTimeAsync(10);
            await jest.runAllTicks();
            await new Promise(setImmediate);
        }
        await clearParentPromise;
        
        // Verify calls
        expect(cacheClientUtils.clearCacheForRecordId).toHaveBeenCalledTimes(mockParentIds.length);
        expect(mockCacheStrategy.removeChildRelationships).toHaveBeenCalledWith(
            `${CacheNamespaces.RELATIONS_CHILD_TO_PARENT}:TestModel:${mockDoc._id}`
        );
    });

    it('should verify relationship cleanup mock calls', async () => {
        const clearParentPromise = cacheClientUtils.clearParentCache(mockDoc as any);
        
        const batchCount = Math.ceil(30 / 25);
        for (let i = 0; i < batchCount; i++) {
            await jest.advanceTimersByTimeAsync(10);
            await jest.runAllTicks();
            await new Promise(setImmediate);
        }
        await clearParentPromise;
        
        expect(mockCacheStrategy.removeChildRelationships).toHaveBeenCalledTimes(1);
        expect(mockCacheStrategy.removeChildRelationships).toHaveBeenCalledWith(
            `${CacheNamespaces.RELATIONS_CHILD_TO_PARENT}:TestModel:${mockDoc._id}`
        );
    }, 30000);

    it('should use default limit when env var is invalid', async () => {
        process.env.CACHE_PARENT_LIMIT = 'invalid';
        const clearParentPromise = cacheClientUtils.clearParentCache(mockDoc as any);
        
        const batchCount = Math.ceil(30 / 25);
        for (let i = 0; i < batchCount; i++) {
            await jest.advanceTimersByTimeAsync(10);
            await jest.runAllTicks();
            await new Promise(setImmediate);
        }
        await clearParentPromise;
        
        expect(mockCacheStrategy.removeChildRelationships).toHaveBeenCalledTimes(1);
        expect(cacheClientUtils.clearCacheForRecordId).toHaveBeenCalledTimes(30);
        expect(mockCacheStrategy.removeChildRelationships).toHaveBeenCalledWith(
            `${CacheNamespaces.RELATIONS_CHILD_TO_PARENT}:TestModel:${mockDoc._id}`
        );
    }, 30000);

    it('should remove child relationships after processing and verify calls', async () => {
        const clearParentPromise = cacheClientUtils.clearParentCache(mockDoc as any);
        
        const batchCount = Math.ceil(30 / 25);
        for (let i = 0; i < batchCount; i++) {
            await jest.advanceTimersByTimeAsync(10);
            await jest.runAllTicks();
            await new Promise(setImmediate);
        }
        await clearParentPromise;
        
        expect(mockCacheStrategy.removeChildRelationships).toHaveBeenCalledWith(
            `${CacheNamespaces.RELATIONS_CHILD_TO_PARENT}:TestModel:${mockDoc._id}`
        );
        expect(cacheClientUtils.clearCacheForRecordId).toHaveBeenCalledTimes(30);
        expect(mockCacheStrategy.removeChildRelationships).toHaveBeenCalledTimes(1);
    }, 30000);
});