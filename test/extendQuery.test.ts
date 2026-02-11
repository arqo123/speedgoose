import mongoose from 'mongoose';
import { applySpeedGooseCacheLayer } from '../src/wrapper';
import { UserModel, setupTestDB, clearTestCache } from './testUtils';
import * as commonUtils from '../src/utils/commonUtils';
import * as cacheClientUtils from '../src/utils/cacheClientUtils';

describe('extendQuery', () => {
    beforeAll(async () => {
        await setupTestDB();
        await applySpeedGooseCacheLayer(mongoose, {
            sharedCacheStrategy: 'inMemory' as any,
            redisUri: 'redis://localhost:6379',
            debugConfig: { enabled: false },
        });
    });

    afterAll(async () => {
        await mongoose.connection.close();
        await mongoose.disconnect();
    });

    beforeEach(async () => {
        await clearTestCache();
        await UserModel.deleteMany({});
    });

    describe('cacheQuery()', () => {
        describe('when caching is enabled', () => {
            it('should return cached result on cache hit (second call returns same data)', async () => {
                const user = await UserModel.create({ name: 'CacheHitUser', email: 'cachehit@test.com' });

                const firstResult = await UserModel.findOne({ _id: user._id }).cacheQuery();
                expect(firstResult).toBeDefined();
                expect(firstResult!.name).toBe('CacheHitUser');

                // Second call should return cached result
                const secondResult = await UserModel.findOne({ _id: user._id }).cacheQuery();
                expect(secondResult).toBeDefined();
                expect(secondResult!.name).toBe('CacheHitUser');
            });

            it('should fetch from DB on cache miss and store in cache', async () => {
                const user = await UserModel.create({ name: 'CacheMissUser', email: 'cachemiss@test.com' });

                // First call: cache miss, should fetch from DB
                const result = await UserModel.findOne({ _id: user._id }).cacheQuery();
                expect(result).toBeDefined();
                expect(result!.name).toBe('CacheMissUser');

                // Verify it's now in cache
                const isCachedResult = await UserModel.findOne({ _id: user._id }).isCached();
                expect(isCachedResult).toBe(true);
            });

            it('should work with findOne queries', async () => {
                const user = await UserModel.create({ name: 'FindOneUser', email: 'findone@test.com' });

                const result = await UserModel.findOne({ _id: user._id }).cacheQuery();
                expect(result).toBeDefined();
                expect(result!.name).toBe('FindOneUser');
            });

            it('should work with find queries', async () => {
                await UserModel.create([
                    { name: 'FindUser1', email: 'find1@test.com' },
                    { name: 'FindUser2', email: 'find2@test.com' },
                ]);

                const results = await UserModel.find({}).cacheQuery();
                expect(results).toBeDefined();
                expect(Array.isArray(results)).toBe(true);
                expect((results as any[]).length).toBe(2);
            });

            it('should work with countDocuments queries', async () => {
                await UserModel.create([
                    { name: 'CountUser1', email: 'count1@test.com' },
                    { name: 'CountUser2', email: 'count2@test.com' },
                    { name: 'CountUser3', email: 'count3@test.com' },
                ]);

                const count = await UserModel.find({}).countDocuments().cacheQuery();
                expect(count).toBe(3);
            });

            it('should work with lean queries', async () => {
                const user = await UserModel.create({ name: 'LeanUser', email: 'lean@test.com' });

                const result = await UserModel.findOne({ _id: user._id }).lean().cacheQuery();
                expect(result).toBeDefined();
                expect(result!.name).toBe('LeanUser');
                // Lean results should be plain objects (no mongoose document methods)
                expect(typeof (result as any).toObject).not.toBe('function');
            });

            it('should accept custom TTL param', async () => {
                const user = await UserModel.create({ name: 'TTLUser', email: 'ttl@test.com' });

                const result = await UserModel.findOne({ _id: user._id }).cacheQuery({ ttl: 120 });
                expect(result).toBeDefined();
                expect(result!.name).toBe('TTLUser');

                // Verify it is cached
                const isCachedResult = await UserModel.findOne({ _id: user._id }).isCached();
                expect(isCachedResult).toBe(true);
            });

            it('should accept custom cacheKey param', async () => {
                const user = await UserModel.create({ name: 'CustomKeyUser', email: 'customkey@test.com' });
                const customKey = 'my-custom-cache-key';

                const result = await UserModel.findOne({ _id: user._id }).cacheQuery({ cacheKey: customKey });
                expect(result).toBeDefined();
                expect(result!.name).toBe('CustomKeyUser');

                // Verify it is cached with the custom key
                const isCachedResult = await UserModel.findOne({ _id: user._id }).isCached({ cacheKey: customKey });
                expect(isCachedResult).toBe(true);
            });
        });

        describe('when caching is disabled', () => {
            it('should fall through to regular exec()', async () => {
                const user = await UserModel.create({ name: 'DisabledUser', email: 'disabled@test.com' });

                const isCachingEnabledSpy = jest.spyOn(commonUtils, 'isCachingEnabled').mockReturnValue(false);

                const result = await UserModel.findOne({ _id: user._id }).cacheQuery();
                expect(result).toBeDefined();
                expect(result!.name).toBe('DisabledUser');

                // Should NOT be cached because caching was disabled
                isCachingEnabledSpy.mockRestore();
                const isCachedResult = await UserModel.findOne({ _id: user._id }).isCached();
                expect(isCachedResult).toBe(false);
            });
        });
    });

    describe('isCached()', () => {
        it('should return false when query result is not cached', async () => {
            const user = await UserModel.create({ name: 'NotCachedUser', email: 'notcached@test.com' });

            const isCachedResult = await UserModel.findOne({ _id: user._id }).isCached();
            expect(isCachedResult).toBe(false);
        });

        it('should return true after cacheQuery() has been called', async () => {
            const user = await UserModel.create({ name: 'CachedUser', email: 'cached@test.com' });

            // Cache the query
            await UserModel.findOne({ _id: user._id }).cacheQuery();

            // Now it should be cached
            const isCachedResult = await UserModel.findOne({ _id: user._id }).isCached();
            expect(isCachedResult).toBe(true);
        });
    });

    describe('cachePopulate()', () => {
        it('should normalize a single string field to [{path: field}]', () => {
            const query = UserModel.findOne({}).cachePopulate('field1');
            expect(query._mongooseOptions.speedGoosePopulate).toEqual([{ path: 'field1' }]);
        });

        it('should normalize a space-separated string to multiple populate options', () => {
            const query = UserModel.findOne({}).cachePopulate('field1 field2');
            expect(query._mongooseOptions.speedGoosePopulate).toEqual([
                { path: 'field1' },
                { path: 'field2' },
            ]);
        });

        it('should wrap a single object in an array', () => {
            const query = UserModel.findOne({}).cachePopulate({ path: 'x' });
            expect(query._mongooseOptions.speedGoosePopulate).toEqual([{ path: 'x' }]);
        });

        it('should pass an array of options as-is', () => {
            const opts = [{ path: 'x' }, { path: 'y' }];
            const query = UserModel.findOne({}).cachePopulate(opts);
            expect(query._mongooseOptions.speedGoosePopulate).toEqual([{ path: 'x' }, { path: 'y' }]);
        });

        it('should return this for chaining', () => {
            const query = UserModel.findOne({});
            const returned = query.cachePopulate('field1');
            expect(returned).toBe(query);
        });

        it('should store options in _mongooseOptions.speedGoosePopulate', () => {
            const query = UserModel.findOne({}).cachePopulate('parent');
            expect(query._mongooseOptions.speedGoosePopulate).toBeDefined();
            expect(Array.isArray(query._mongooseOptions.speedGoosePopulate)).toBe(true);
        });

        it('should accumulate options across multiple cachePopulate() calls', () => {
            const query = UserModel.findOne({})
                .cachePopulate('field1')
                .cachePopulate('field2');

            expect(query._mongooseOptions.speedGoosePopulate).toEqual([
                { path: 'field1' },
                { path: 'field2' },
            ]);
        });

        it('should handle empty string by producing empty array', () => {
            const query = UserModel.findOne({}).cachePopulate('');
            expect(query._mongooseOptions.speedGoosePopulate).toEqual([]);
        });
    });

    describe('execQueryWithCache flow', () => {
        it('should call refreshTTLTimeIfNeeded on cache hit', async () => {
            const refreshSpy = jest.spyOn(cacheClientUtils, 'refreshTTLTimeIfNeeded');
            const user = await UserModel.create({ name: 'RefreshTTLUser', email: 'refresh@test.com' });

            // First call populates cache
            await UserModel.findOne({ _id: user._id }).cacheQuery();
            refreshSpy.mockClear();

            // Second call should be a cache hit and call refreshTTLTimeIfNeeded
            await UserModel.findOne({ _id: user._id }).cacheQuery();
            expect(refreshSpy).toHaveBeenCalled();

            refreshSpy.mockRestore();
        });

        it('should call setKeyInResultsCaches on cache miss', async () => {
            const setKeySpy = jest.spyOn(cacheClientUtils, 'setKeyInResultsCaches');
            const user = await UserModel.create({ name: 'SetKeyUser', email: 'setkey@test.com' });

            // First call is a cache miss
            await UserModel.findOne({ _id: user._id }).cacheQuery();
            expect(setKeySpy).toHaveBeenCalled();

            setKeySpy.mockRestore();
        });

        it('should not call setKeyInResultsCaches on cache hit', async () => {
            const user = await UserModel.create({ name: 'NoSetKeyUser', email: 'nosetkey@test.com' });

            // First call populates cache
            await UserModel.findOne({ _id: user._id }).cacheQuery();

            const setKeySpy = jest.spyOn(cacheClientUtils, 'setKeyInResultsCaches');

            // Second call is a cache hit, should NOT call setKeyInResultsCaches
            await UserModel.findOne({ _id: user._id }).cacheQuery();
            expect(setKeySpy).not.toHaveBeenCalled();

            setKeySpy.mockRestore();
        });

        it('should return raw result for lean queries (no hydration)', async () => {
            const user = await UserModel.create({ name: 'LeanNoHydrate', email: 'leannohydrate@test.com' });

            const result = await UserModel.findOne({ _id: user._id }).lean().cacheQuery();
            expect(result).toBeDefined();
            expect(result!.name).toBe('LeanNoHydrate');
            // Lean result is a plain object
            expect(typeof (result as any).save).not.toBe('function');
        });

        it('should return raw result for count queries (no hydration)', async () => {
            await UserModel.create([
                { name: 'CountA', email: 'counta@test.com' },
                { name: 'CountB', email: 'countb@test.com' },
            ]);

            const count = await UserModel.find({}).countDocuments().cacheQuery();
            expect(count).toBe(2);

            // Second call from cache
            const cachedCount = await UserModel.find({}).countDocuments().cacheQuery();
            expect(cachedCount).toBe(2);
        });

        it('should return raw result for distinct queries (no hydration)', async () => {
            await UserModel.create([
                { name: 'Alice', email: 'alice@test.com' },
                { name: 'Bob', email: 'bob@test.com' },
                { name: 'Alice', email: 'alice2@test.com' },
            ]);

            const result = await UserModel.distinct('name').cacheQuery();
            expect(result).toBeDefined();
            expect(Array.isArray(result)).toBe(true);
            expect((result as string[]).sort()).toEqual(['Alice', 'Bob']);
        });
    });
});
