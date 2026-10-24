/**
 * Regression: invalidation sets expired before the results they index.
 * Sets always got `setsTtl` (default 2 * defaultTtl) even for a query with a longer ttl, so after
 * setsTtl an update could no longer find (and clear) the still-cached result.
 * Expected: sets get max(setsTtl, query ttl), and a later shorter write never shrinks it.
 * IN_MEMORY strategy so the stored expiry can be read back (real-Redis variant: test/redis/auditRedis.redis.test.ts).
 */
import mongoose from 'mongoose';
import Container from 'typedi';
import Keyv from 'keyv';
import { applySpeedGooseCacheLayer } from '../../src/wrapper';
import { SharedCacheStrategies } from '../../src/types/types';
import { getCacheStrategyInstance } from '../../src/utils/commonUtils';
import { UserModel, clearTestCache, setupTestDB } from '../testUtils';

/** Remaining TTL (seconds) of an invalidation set, -1 if it has no expiry, null if missing. */
const remainingSetTtl = async (namespace: string): Promise<number | null> => {
    const setsClient: Keyv<any> = (getCacheStrategyInstance() as any).recordResultsSetsClient;
    const raw: any = await setsClient.get(namespace, { raw: true });
    if (!raw) return null;
    return typeof raw.expires === 'number' ? (raw.expires - Date.now()) / 1000 : -1;
};

describe('invalidation sets outlive the results they index', () => {
    beforeAll(async () => setupTestDB(), 60000);
    afterAll(async () => {
        await mongoose.connection.close();
        await mongoose.disconnect();
    });

    const apply = async (config: Record<string, unknown>) => {
        Container.reset();
        await applySpeedGooseCacheLayer(mongoose, { sharedCacheStrategy: SharedCacheStrategies.IN_MEMORY, ...config });
        await clearTestCache();
    };

    test('a query ttl longer than setsTtl extends the model and record sets to that ttl', async () => {
        await apply({ defaultTtl: 1 }); // setsTtl defaults to 2
        const user = await UserModel.create({ name: 'long-ttl' });
        await UserModel.findById(user._id).lean().cacheQuery({ ttl: 600 });

        expect(await remainingSetTtl(String(user._id))).toBeGreaterThan(590);
        expect(await remainingSetTtl('User_')).toBeGreaterThan(590);
    });

    test('a later query with a shorter ttl does not shrink the record set expiry', async () => {
        await apply({ defaultTtl: 1 });
        const user = await UserModel.create({ name: 'shrink' });
        await UserModel.findById(user._id).lean().cacheQuery({ ttl: 600 });
        await UserModel.find({ _id: user._id }).lean().cacheQuery({ ttl: 5 });

        expect(await remainingSetTtl(String(user._id))).toBeGreaterThan(590);
    });

    test('setsTtl 0 still means the sets never expire', async () => {
        await apply({ defaultTtl: 1, setsTtl: 0 });
        const user = await UserModel.create({ name: 'no-expiry' });
        await UserModel.findById(user._id).lean().cacheQuery({ ttl: 600 });

        expect(await remainingSetTtl(String(user._id))).toBe(-1);
    });
});
