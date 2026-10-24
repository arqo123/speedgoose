/**
 * Regression: the hydration variations index (recordId -> Set of hydration cache keys) was written
 * without a TTL, so for read-only records it outlived every hydrated document it pointed to and grew
 * by one member per projection/populate variant, forever.
 * Hydration is only enabled for the Redis strategy (ioredis-mock here).
 */
import mongoose from 'mongoose';
import Container from 'typedi';
import { applySpeedGooseCacheLayer } from '../../src/wrapper';
import { SharedCacheStrategies } from '../../src/types/types';
import { getCacheStrategyInstance, getHydrationVariationsCache } from '../../src/utils/commonUtils';
import { UserModel, setupTestDB, clearTestCache } from '../testUtils';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('hydration variations index does not outlive the hydrated documents', () => {
    beforeAll(async () => setupTestDB());
    afterAll(async () => {
        await mongoose.connection.close();
        await mongoose.disconnect();
    });

    beforeEach(async () => {
        Container.reset();
        await applySpeedGooseCacheLayer(mongoose, { redisUri: 'redis://localhost:6379', sharedCacheStrategy: SharedCacheStrategies.REDIS, defaultTtl: 1 });
        await clearTestCache();
        await UserModel.deleteMany({});
        expect(getCacheStrategyInstance().isHydrationEnabled()).toBe(true);
    });

    it('expires the variations set of a record that is never written again', async () => {
        const user = await UserModel.create({ name: 'a', email: 'e', age: 1, fieldA: 'f' });
        for (const projection of ['name', 'email', 'age', 'fieldA', 'name email', 'name age']) {
            await UserModel.findById(user._id).select(projection).cacheQuery({ ttl: 1 });
        }
        await sleep(100);

        const variations = await getHydrationVariationsCache().get(String(user._id));
        expect(variations?.size).toBe(6);
        const raw: any = await getHydrationVariationsCache().get(String(user._id), { raw: true });
        expect(typeof raw?.expires).toBe('number');

        // Hydrated docs live 1s; setsTtl is defaultTtl*2 = 2s. Generous margin.
        await sleep(4000);
        expect(await getHydrationVariationsCache().get(String(user._id))).toBeUndefined();
    }, 15_000);
});
