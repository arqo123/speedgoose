/**
 * Regressions in cachePopulate TTL handling (IN_MEMORY strategy, so expiry can be read back):
 *  - `ttl: 0` survived `??`, and Keyv treats 0 as "no expiry": populated docs were cached forever.
 *  - the Query.exec wrapper never passed the cacheQuery TTL, so populated docs never inherited it.
 *  - the last-resort default was a hard-coded 60s instead of `config.defaultTtl`.
 *  - inheritance must follow the README ("TTL Inheritance"):
 *      'fallback' (default): the cachePopulate ttl is used only if no global TTL is set;
 *      'override': the cachePopulate ttl always takes precedence over the global TTL.
 *    "Global TTL" is read here as the TTL of the enclosing cacheQuery(); config.defaultTtl is the
 *    final fallback when neither is set.
 */
import mongoose from 'mongoose';
import Container from 'typedi';
import Keyv from 'keyv';
import { applySpeedGooseCacheLayer } from '../../src/wrapper';
import { SharedCacheStrategies, TtlInheritance } from '../../src/types/types';
import { getCacheStrategyInstance } from '../../src/utils/commonUtils';
import { getDocumentCacheKey } from '../../src/utils/populationUtils';
import { UserModel, clearTestCache, setupTestDB } from '../testUtils';

const DEFAULT_TTL = 900;

const createParentWithChild = async () => {
    const child = await UserModel.create({ name: 'child', email: 'c' });
    const parent = await UserModel.create({ name: 'parent', email: 'p', relationField: child._id });
    return { parent, child };
};

/** Remaining TTL (seconds) of the cached populated child document, or null if it is not cached / has no expiry. */
const remainingDocTtl = async (childId: unknown): Promise<number | null> => {
    const docsClient: Keyv<any> = (getCacheStrategyInstance() as any).documentsCacheClient;
    const raw: any = await docsClient.get(getDocumentCacheKey('User', String(childId)), { raw: true });
    if (!raw || typeof raw.expires !== 'number') return null;
    return (raw.expires - Date.now()) / 1000;
};

describe('cachePopulate TTL', () => {
    beforeAll(async () => setupTestDB());
    afterAll(async () => {
        await mongoose.connection.close();
        await mongoose.disconnect();
    });

    beforeEach(async () => {
        Container.reset();
        await applySpeedGooseCacheLayer(mongoose, { sharedCacheStrategy: SharedCacheStrategies.IN_MEMORY, defaultTtl: DEFAULT_TTL });
        await clearTestCache();
        await UserModel.deleteMany({});
    });

    it('ttl: 0 bypasses the populated document cache (no write, no read)', async () => {
        const { parent, child } = await createParentWithChild();
        const populate = () => UserModel.findById(parent._id).lean().cachePopulate({ path: 'relationField', ttl: 0 }).exec() as Promise<any>;

        expect((await populate()).relationField.name).toBe('child');
        const cached = await getCacheStrategyInstance().getDocuments([getDocumentCacheKey('User', String(child._id))]);
        expect(cached.size).toBe(0);

        // Change the child without triggering invalidation: a bypassing populate must see it.
        await UserModel.collection.updateOne({ _id: child._id }, { $set: { name: 'silently-changed' } });
        expect((await populate()).relationField.name).toBe('silently-changed');
    });

    it('populated documents inherit the cacheQuery TTL when cachePopulate sets none', async () => {
        const { parent, child } = await createParentWithChild();
        await UserModel.findById(parent._id).lean().cachePopulate({ path: 'relationField' }).cacheQuery({ ttl: 3600 });

        const remaining = await remainingDocTtl(child._id);
        expect(remaining).toBeGreaterThan(3500);
        expect(remaining).toBeLessThanOrEqual(3600);
    });

    it('falls back to config.defaultTtl (not a hard-coded 60s) when neither cachePopulate nor cacheQuery sets a TTL', async () => {
        const { parent, child } = await createParentWithChild();
        await UserModel.findById(parent._id).lean().cachePopulate({ path: 'relationField' }).exec();

        const remaining = await remainingDocTtl(child._id);
        expect(remaining).toBeGreaterThan(DEFAULT_TTL - 100);
        expect(remaining).toBeLessThanOrEqual(DEFAULT_TTL);
    });

    it("README 'fallback' (default): the cacheQuery TTL wins over the cachePopulate ttl", async () => {
        const { parent, child } = await createParentWithChild();
        await UserModel.findById(parent._id).lean().cachePopulate({ path: 'relationField', ttl: 300 }).cacheQuery({ ttl: 3600 });

        const remaining = await remainingDocTtl(child._id);
        expect(remaining).toBeGreaterThan(3500);
        expect(remaining).toBeLessThanOrEqual(3600);
    });

    it("README 'fallback': the cachePopulate ttl is used when there is no enclosing cacheQuery TTL", async () => {
        const { parent, child } = await createParentWithChild();
        await UserModel.findById(parent._id).lean().cachePopulate({ path: 'relationField', ttl: 300, ttlInheritance: TtlInheritance.FALLBACK }).exec();

        const remaining = await remainingDocTtl(child._id);
        expect(remaining).toBeGreaterThan(250);
        expect(remaining).toBeLessThanOrEqual(300);
    });

    it('the cachePopulate ttl is used under cacheQuery() without a ttl (the default ttl does not hide it)', async () => {
        const { parent, child } = await createParentWithChild();
        await UserModel.findById(parent._id).lean().cachePopulate({ path: 'relationField', ttl: 300 }).cacheQuery();

        const remaining = await remainingDocTtl(child._id);
        expect(remaining).toBeGreaterThan(250);
        expect(remaining).toBeLessThanOrEqual(300);
    });

    it("README 'override': the cachePopulate ttl wins over the cacheQuery TTL", async () => {
        const { parent, child } = await createParentWithChild();
        await UserModel.findById(parent._id).lean().cachePopulate({ path: 'relationField', ttl: 300, ttlInheritance: TtlInheritance.OVERRIDE }).cacheQuery({ ttl: 3600 });

        const remaining = await remainingDocTtl(child._id);
        expect(remaining).toBeGreaterThan(250);
        expect(remaining).toBeLessThanOrEqual(300);
    });
});
