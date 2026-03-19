import mongoose from 'mongoose';
import { applySpeedGooseCacheLayer } from '../../src/wrapper';
import { UserModel, setupTestDB, clearTestCache } from '../testUtils';
import { IUser } from '../types';

/**
 * Bug report: cachePopulate caches populated documents by _id but the cache key
 * may not account for the `select` projection. If two different queries populate
 * the same document (e.g., user 648be3f1) but with a different select:
 *
 * Query 1: .cachePopulate({ path: 'parent', select: 'name' })
 *   → cache stores parent 648be3f1 with only { name }
 *
 * Query 2: .cachePopulate({ path: 'parent' })   // no select — wants FULL document
 *   → cache HIT on parent 648be3f1 → returns { name } only → missing email, fieldA, etc.
 *
 * Expected: Query 2 should get the full document (cache miss, fetch from DB).
 */
describe('BUG: cachePopulate select collision', () => {
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

    it('should NOT return partial document when second query has no select (full populate)', async () => {
        // Setup: parent with multiple fields
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

        // Query 1: populate parent with SELECT (only 'name')
        const result1 = await UserModel.findOne({ _id: child._id }).cachePopulate({ path: 'parent', select: 'name' }).exec();

        expect(result1).toBeDefined();
        const parent1 = result1!.parent as IUser;
        expect(parent1.name).toBe('FullParent');
        // select 'name' → email should NOT be present
        expect(parent1.email).toBeUndefined();
        expect(parent1.fieldA).toBeUndefined();

        // Query 2: populate parent WITHOUT select → wants FULL document
        const result2 = await UserModel.findOne({ _id: child._id }).cachePopulate({ path: 'parent' }).exec();

        expect(result2).toBeDefined();
        const parent2 = result2!.parent as IUser;

        // THIS IS THE BUG CHECK:
        // If cachePopulate ignores select in cache key, parent2 will be the
        // partial version from Query 1 (only 'name', missing 'email' and 'fieldA').
        expect(parent2.name).toBe('FullParent');
        expect(parent2.email).toBe('full@example.com'); // <-- would fail if cache collision
        expect(parent2.fieldA).toBe('important_data'); // <-- would fail if cache collision
        expect(parent2.age).toBe(42); // <-- would fail if cache collision
    });

    it('should NOT return full document when second query has narrower select', async () => {
        // Reverse scenario: full populate first, then narrow select
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

        // Query 1: populate parent WITHOUT select (full)
        const result1 = await UserModel.findOne({ _id: child._id }).cachePopulate({ path: 'parent' }).exec();

        expect(result1).toBeDefined();
        const parent1 = result1!.parent as IUser;
        expect(parent1.name).toBe('FullParent');
        expect(parent1.email).toBe('full@example.com');

        // Query 2: populate parent WITH select 'name' only
        const result2 = await UserModel.findOne({ _id: child._id }).cachePopulate({ path: 'parent', select: 'name' }).exec();

        expect(result2).toBeDefined();
        const parent2 = result2!.parent as IUser;

        // If cache collision: parent2 would have email/fieldA from full populate
        expect(parent2.name).toBe('FullParent');
        expect(parent2.email).toBeUndefined(); // <-- select 'name' should exclude email
        expect(parent2.fieldA).toBeUndefined(); // <-- select 'name' should exclude fieldA
    });

    it('should cache different select variants independently', async () => {
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
        const resultA = await UserModel.findOne({ _id: child._id }).cachePopulate({ path: 'parent', select: 'name email' }).exec();
        const parentA = resultA!.parent as IUser;
        expect(parentA.name).toBe('Parent');
        expect(parentA.email).toBe('parent@example.com');
        expect(parentA.fieldA).toBeUndefined();

        // Query B: select 'name fieldA'
        const resultB = await UserModel.findOne({ _id: child._id }).cachePopulate({ path: 'parent', select: 'name fieldA' }).exec();
        const parentB = resultB!.parent as IUser;
        expect(parentB.name).toBe('Parent');
        expect(parentB.fieldA).toBe('extra');
        expect(parentB.email).toBeUndefined(); // <-- should NOT have email

        // Query C: no select (full)
        const resultC = await UserModel.findOne({ _id: child._id }).cachePopulate({ path: 'parent' }).exec();
        const parentC = resultC!.parent as IUser;
        expect(parentC.name).toBe('Parent');
        expect(parentC.email).toBe('parent@example.com');
        expect(parentC.fieldA).toBe('extra');
        expect(parentC.age).toBe(30);
    });
});
