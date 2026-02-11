import mongoose from 'mongoose';
import { applySpeedGooseCacheLayer } from '../src/wrapper';
import { UserModel, setupTestDB, clearTestCache, generateTestAggregateQuery } from './testUtils';
import * as cacheClientUtils from '../src/utils/cacheClientUtils';
import * as commonUtils from '../src/utils/commonUtils';

describe('extendAggregate', () => {
    beforeAll(async () => {
        await setupTestDB();
        await applySpeedGooseCacheLayer(mongoose, {});
    });

    afterAll(async () => {
        await mongoose.connection.close();
        await mongoose.disconnect();
    });

    beforeEach(async () => {
        await clearTestCache();
        await UserModel.deleteMany({});
    });

    describe('cachePipeline() - caching enabled', () => {
        beforeEach(async () => {
            await UserModel.create([
                { name: 'Alice', email: 'alice@test.com', age: 30 },
                { name: 'Bob', email: 'bob@test.com', age: 25 },
                { name: 'Charlie', email: 'charlie@test.com', age: 30 },
            ]);
        });

        it('should return cached result on second call (cache hit)', async () => {
            const pipeline = [{ $match: { age: 30 } }, { $sort: { name: 1 } }];

            const firstResult = await generateTestAggregateQuery(pipeline).cachePipeline();
            expect(firstResult).toHaveLength(2);

            // Spy on getResultsFromCache to verify the second call returns from cache
            const cacheSpy = jest.spyOn(cacheClientUtils, 'getResultsFromCache');

            const secondResult = await generateTestAggregateQuery(pipeline).cachePipeline();
            expect(secondResult).toHaveLength(2);
            expect(secondResult).toEqual(firstResult);

            // getResultsFromCache should have been called and returned a truthy value (cache hit)
            expect(cacheSpy).toHaveBeenCalled();
            const cacheReturnValue = await cacheSpy.mock.results[0].value;
            expect(cacheReturnValue).toBeTruthy();

            cacheSpy.mockRestore();
        });

        it('should fetch from DB on cache miss and store in cache', async () => {
            const pipeline = [{ $match: { age: 25 } }];

            const spy = jest.spyOn(cacheClientUtils, 'getResultsFromCache');

            const result = await generateTestAggregateQuery(pipeline).cachePipeline();
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Bob');

            // First call should have returned null from cache (miss)
            expect(spy).toHaveBeenCalled();

            // Second call should hit cache
            const cachedResult = await generateTestAggregateQuery(pipeline).cachePipeline();
            expect(cachedResult).toHaveLength(1);
            expect(cachedResult[0].name).toBe('Bob');

            spy.mockRestore();
        });

        it('should work with $group pipeline', async () => {
            const pipeline = [
                { $group: { _id: '$age', count: { $sum: 1 } } },
                { $sort: { _id: 1 } },
            ];

            const result = await generateTestAggregateQuery(pipeline).cachePipeline();
            expect(result).toHaveLength(2);

            const age25Group = result.find((r: any) => r._id === 25);
            const age30Group = result.find((r: any) => r._id === 30);
            expect(age25Group.count).toBe(1);
            expect(age30Group.count).toBe(2);

            // Verify cached result is the same
            const cachedResult = await generateTestAggregateQuery(pipeline).cachePipeline();
            expect(cachedResult).toEqual(result);
        });

        it('should work with $match pipeline', async () => {
            const pipeline = [{ $match: { name: 'Alice' } }];

            const result = await generateTestAggregateQuery(pipeline).cachePipeline();
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Alice');
        });

        it('should work with $sort pipeline', async () => {
            const pipeline = [{ $sort: { name: -1 } }];

            const result = await generateTestAggregateQuery(pipeline).cachePipeline();
            expect(result).toHaveLength(3);
            expect(result[0].name).toBe('Charlie');
            expect(result[1].name).toBe('Bob');
            expect(result[2].name).toBe('Alice');
        });

        it('should accept custom TTL param', async () => {
            const pipeline = [{ $match: { age: 30 } }];

            const result = await generateTestAggregateQuery(pipeline).cachePipeline({ ttl: 120 });
            expect(result).toHaveLength(2);

            // Verify it is cached
            const isCachedResult = await generateTestAggregateQuery(pipeline).isCached();
            expect(isCachedResult).toBe(true);
        });

        it('should accept custom cacheKey param', async () => {
            const pipeline = [{ $match: { age: 30 } }];
            const customKey = 'my-custom-aggregate-key';

            const result = await generateTestAggregateQuery(pipeline).cachePipeline({ cacheKey: customKey });
            expect(result).toHaveLength(2);

            // Verify it is cached with the custom key
            const isCachedResult = await generateTestAggregateQuery(pipeline).isCached({ cacheKey: customKey });
            expect(isCachedResult).toBe(true);
        });

        it('should return a plain array (not Aggregate object)', async () => {
            const pipeline = [{ $match: { age: 30 } }];

            const result = await generateTestAggregateQuery(pipeline).cachePipeline();
            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(2);
        });
    });

    describe('cachePipeline() - caching disabled', () => {
        it('should fall through to regular exec() when caching is disabled', async () => {
            await UserModel.create({ name: 'DisabledTest', email: 'disabled@test.com', age: 40 });

            const spy = jest.spyOn(commonUtils, 'isCachingEnabled').mockReturnValue(false);

            const pipeline = [{ $match: { age: 40 } }];
            const result = await generateTestAggregateQuery(pipeline).cachePipeline();
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('DisabledTest');

            // Should not be cached since caching is disabled
            spy.mockRestore();
            const isCachedResult = await generateTestAggregateQuery(pipeline).isCached();
            expect(isCachedResult).toBe(false);
        });
    });

    describe('isCached()', () => {
        beforeEach(async () => {
            await UserModel.create({ name: 'CacheCheckUser', email: 'cachecheck@test.com', age: 50 });
        });

        it('should return false when not cached', async () => {
            const pipeline = [{ $match: { age: 50 } }];
            const result = await generateTestAggregateQuery(pipeline).isCached();
            expect(result).toBe(false);
        });

        it('should return true after cachePipeline()', async () => {
            const pipeline = [{ $match: { age: 50 } }];

            await generateTestAggregateQuery(pipeline).cachePipeline();

            const result = await generateTestAggregateQuery(pipeline).isCached();
            expect(result).toBe(true);
        });
    });

    describe('execAggregationWithCache flow', () => {
        beforeEach(async () => {
            await UserModel.create([
                { name: 'FlowUser1', email: 'flow1@test.com', age: 60 },
                { name: 'FlowUser2', email: 'flow2@test.com', age: 70 },
            ]);
        });

        it('should call refreshTTLTimeIfNeeded on cache hit', async () => {
            const spy = jest.spyOn(cacheClientUtils, 'refreshTTLTimeIfNeeded');

            const pipeline = [{ $match: { age: 60 } }];

            // First call - cache miss, no TTL refresh
            await generateTestAggregateQuery(pipeline).cachePipeline();
            spy.mockClear();

            // Second call - cache hit, should refresh TTL
            await generateTestAggregateQuery(pipeline).cachePipeline();
            expect(spy).toHaveBeenCalled();

            spy.mockRestore();
        });

        it('should call setKeyInResultsCaches on cache miss', async () => {
            const spy = jest.spyOn(cacheClientUtils, 'setKeyInResultsCaches');

            const pipeline = [{ $match: { age: 70 } }];

            await generateTestAggregateQuery(pipeline).cachePipeline();

            expect(spy).toHaveBeenCalled();
            spy.mockRestore();
        });

        it('should generate different cache keys for different pipelines', async () => {
            const pipeline1 = [{ $match: { age: 60 } }];
            const pipeline2 = [{ $match: { age: 70 } }];

            const result1 = await generateTestAggregateQuery(pipeline1).cachePipeline();
            expect(result1).toHaveLength(1);
            expect(result1[0].name).toBe('FlowUser1');

            const result2 = await generateTestAggregateQuery(pipeline2).cachePipeline();
            expect(result2).toHaveLength(1);
            expect(result2[0].name).toBe('FlowUser2');

            // Verify each returns its own cached result (from cache, not DB)
            const cacheSpy = jest.spyOn(cacheClientUtils, 'getResultsFromCache');

            const cachedResult1 = await generateTestAggregateQuery(pipeline1).cachePipeline();
            const cachedResult2 = await generateTestAggregateQuery(pipeline2).cachePipeline();

            expect(cachedResult1[0].name).toBe('FlowUser1');
            expect(cachedResult2[0].name).toBe('FlowUser2');

            // Both calls should have been cache hits
            expect(cacheSpy).toHaveBeenCalledTimes(2);
            const cacheReturn1 = await cacheSpy.mock.results[0].value;
            const cacheReturn2 = await cacheSpy.mock.results[1].value;
            expect(cacheReturn1).toBeTruthy();
            expect(cacheReturn2).toBeTruthy();

            cacheSpy.mockRestore();
        });
    });

    describe('Edge cases', () => {
        it('should cache empty result set correctly', async () => {
            const pipeline = [{ $match: { age: 999 } }];

            const result = await generateTestAggregateQuery(pipeline).cachePipeline();
            expect(result).toEqual([]);

            // Should be cached even though empty
            const isCachedResult = await generateTestAggregateQuery(pipeline).isCached();
            expect(isCachedResult).toBe(true);

            // Should return empty array from cache
            const cachedResult = await generateTestAggregateQuery(pipeline).cachePipeline();
            expect(cachedResult).toEqual([]);
        });

        it('should not have different pipelines on same model interfere with each other', async () => {
            await UserModel.create([
                { name: 'EdgeUser1', email: 'edge1@test.com', age: 80 },
                { name: 'EdgeUser2', email: 'edge2@test.com', age: 90 },
            ]);

            const pipeline1 = [{ $match: { age: 80 } }];
            const pipeline2 = [{ $match: { age: 90 } }];
            const pipeline3 = [{ $group: { _id: '$age', count: { $sum: 1 } } }];

            const result1 = await generateTestAggregateQuery(pipeline1).cachePipeline();
            const result2 = await generateTestAggregateQuery(pipeline2).cachePipeline();
            const result3 = await generateTestAggregateQuery(pipeline3).cachePipeline();

            expect(result1).toHaveLength(1);
            expect(result1[0].name).toBe('EdgeUser1');

            expect(result2).toHaveLength(1);
            expect(result2[0].name).toBe('EdgeUser2');

            expect(result3).toHaveLength(2);

            // Verify each pipeline returns its own cached result independently
            const cachedResult1 = await generateTestAggregateQuery(pipeline1).cachePipeline();
            const cachedResult2 = await generateTestAggregateQuery(pipeline2).cachePipeline();
            const cachedResult3 = await generateTestAggregateQuery(pipeline3).cachePipeline();

            expect(cachedResult1).toEqual(result1);
            expect(cachedResult2).toEqual(result2);
            expect(cachedResult3).toEqual(result3);
        });
    });
});
