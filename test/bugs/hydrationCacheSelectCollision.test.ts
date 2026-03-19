import mongoose from 'mongoose';
import { applySpeedGooseCacheLayer } from '../../src/wrapper';
import { UserModel, setupTestDB, clearTestCache } from '../testUtils';
import { SharedCacheStrategies } from '../../src/types/types';
import { getCacheStrategyInstance } from '../../src/utils/commonUtils';
import Container from 'typedi';
import { IUser } from '../types';

/**
 * BUG: Hydration cache key collision when using native .populate() + .cacheQuery()
 * with Redis strategy (hydration enabled).
 *
 * generateCacheKeyForSingleDocument() uses query.getPopulatedPaths() which returns
 * only path NAMES (e.g. ['parent']), not populate options (select, match, etc.).
 *
 * Two queries that populate the same path but with different select options produce
 * the SAME hydration cache key → second query gets stale hydrated document from first.
 *
 * NOTE: This test must use Redis strategy (even mocked) because InMemoryStrategy
 * has hydration DISABLED (isHydrationEnabled() = false).
 */
describe('BUG: hydration cache select collision with .populate().cacheQuery()', () => {
    beforeAll(async () => {
        await setupTestDB();
    });

    afterAll(async () => {
        await mongoose.connection.close();
        await mongoose.disconnect();
    });

    beforeEach(async () => {
        // Reset DI container and re-register with REDIS strategy (uses ioredis-mock from setupTestEnv)
        Container.reset();
        await applySpeedGooseCacheLayer(mongoose, {
            redisUri: 'redis://localhost:6379',
            sharedCacheStrategy: SharedCacheStrategies.REDIS,
        });

        await clearTestCache();
        await UserModel.deleteMany({});

        // Verify we're using Redis strategy with hydration enabled
        const strategy = getCacheStrategyInstance();
        expect(strategy.constructor.name).toBe('RedisStrategy');
        expect(strategy.isHydrationEnabled()).toBe(true);
    });

    it('should NOT return partial document when second query populates without select', async () => {
        // Setup
        const parent = await UserModel.create({
            name: 'FullParent',
            email: 'full@example.com',
            fieldA: 'important_data',
            age: 42,
        });

        const child = await UserModel.create({
            name: 'Child',
            email: 'child@example.com',
            parent: parent._id,
        });

        // Query 1: populate with select 'name' + cacheQuery → hydration cache stores
        // document with parent having only 'name' under key "{childId}__parent"
        const result1 = (await UserModel.findOne({ _id: child._id }).populate({ path: 'parent', select: 'name' }).cacheQuery()) as IUser;

        expect(result1).toBeDefined();
        const parent1 = result1.parent as IUser;
        expect(parent1.name).toBe('FullParent');
        expect(parent1.email).toBeUndefined();

        // Query 2: populate WITHOUT select (full) + cacheQuery
        // Results cache key is DIFFERENT (generateCacheKeyFromQuery includes populate select)
        // → results cache miss → DB query → gets FULL parent
        // BUT: getHydratedDocument checks hydration cache → key "{childId}__parent" → HIT!
        // → returns stale document from Query 1 with only 'name'
        const result2 = (await UserModel.findOne({ _id: child._id }).populate({ path: 'parent' }).cacheQuery()) as IUser;

        expect(result2).toBeDefined();
        const parent2 = result2.parent as IUser;

        // BUG CHECK: if hydration cache collision, parent2 will be partial (only 'name')
        expect(parent2.name).toBe('FullParent');
        expect(parent2.email).toBe('full@example.com'); // ← FAILS if hydration collision
        expect(parent2.fieldA).toBe('important_data'); // ← FAILS if hydration collision
        expect(parent2.age).toBe(42); // ← FAILS if hydration collision
    });

    it('reverse: full populate first, then narrow select — should not leak fields', async () => {
        const parent = await UserModel.create({
            name: 'FullParent',
            email: 'full@example.com',
            fieldA: 'important_data',
            age: 42,
        });

        const child = await UserModel.create({
            name: 'Child',
            email: 'child@example.com',
            parent: parent._id,
        });

        // Query 1: full populate + cacheQuery
        const result1 = (await UserModel.findOne({ _id: child._id }).populate({ path: 'parent' }).cacheQuery()) as IUser;

        expect(result1).toBeDefined();
        const parent1 = result1.parent as IUser;
        expect(parent1.name).toBe('FullParent');
        expect(parent1.email).toBe('full@example.com');

        // Query 2: populate with select 'name' only + cacheQuery
        // Hydration cache collision: returns full parent from Q1 instead of partial
        const result2 = (await UserModel.findOne({ _id: child._id }).populate({ path: 'parent', select: 'name' }).cacheQuery()) as IUser;

        expect(result2).toBeDefined();
        const parent2 = result2.parent as IUser;

        // BUG CHECK: if hydration collision, parent2 would have email/fieldA from Q1
        expect(parent2.name).toBe('FullParent');
        expect(parent2.email).toBeUndefined(); // ← FAILS if hydration collision (would have email)
        expect(parent2.fieldA).toBeUndefined(); // ← FAILS if hydration collision
    });

    it('different select variants should produce independent hydration keys', async () => {
        const parent = await UserModel.create({
            name: 'Parent',
            email: 'parent@example.com',
            fieldA: 'extra',
            age: 30,
        });

        const child = await UserModel.create({
            name: 'Child',
            email: 'child@example.com',
            parent: parent._id,
        });

        // Query A: select 'name email'
        const resultA = (await UserModel.findOne({ _id: child._id }).populate({ path: 'parent', select: 'name email' }).cacheQuery()) as IUser;
        const parentA = resultA.parent as IUser;
        expect(parentA.name).toBe('Parent');
        expect(parentA.email).toBe('parent@example.com');
        expect(parentA.fieldA).toBeUndefined();

        // Query B: select 'name fieldA'
        const resultB = (await UserModel.findOne({ _id: child._id }).populate({ path: 'parent', select: 'name fieldA' }).cacheQuery()) as IUser;
        const parentB = resultB.parent as IUser;
        expect(parentB.name).toBe('Parent');
        expect(parentB.fieldA).toBe('extra');
        expect(parentB.email).toBeUndefined(); // ← should NOT have email

        // Query C: no select (full)
        const resultC = (await UserModel.findOne({ _id: child._id }).populate({ path: 'parent' }).cacheQuery()) as IUser;
        const parentC = resultC.parent as IUser;
        expect(parentC.name).toBe('Parent');
        expect(parentC.email).toBe('parent@example.com');
        expect(parentC.fieldA).toBe('extra');
        expect(parentC.age).toBe(30);
    });
});
