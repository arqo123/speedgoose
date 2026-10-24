/**
 * Regression: a non-integer or non-finite query ttl produced cache entries that never expire.
 *  - Redis: `SET` succeeded and the pipelined `EXPIRE NaN|1.5|Infinity` failed silently -> TTL -1.
 *  - Keyv (in-memory): `expires = Date.now() + NaN|Infinity` never compares as expired.
 * Expected: NaN/Infinity fall back to defaultTtl, fractional ttls round up (Math.ceil).
 * IN_MEMORY strategy so the stored expiry can be read back.
 */
import mongoose from 'mongoose';
import Container from 'typedi';
import Keyv from 'keyv';
import { applySpeedGooseCacheLayer } from '../../src/wrapper';
import { SharedCacheStrategies } from '../../src/types/types';
import { getCacheStrategyInstance } from '../../src/utils/commonUtils';
import { UserModel, clearTestCache, setupTestDB } from '../testUtils';

const DEFAULT_TTL = 900;

/** Remaining TTL (seconds) of a cached result, or null if it is not cached / has no finite expiry. */
const remainingResultTtl = async (cacheKey: string): Promise<number | null> => {
    const resultsClient: Keyv<any> = (getCacheStrategyInstance() as any).resultsCacheClient;
    const raw: any = await resultsClient.get(`resultsNamespace:${cacheKey}`, { raw: true });
    if (!raw || typeof raw.expires !== 'number' || !Number.isFinite(raw.expires)) return null;
    return (raw.expires - Date.now()) / 1000;
};

describe('invalid query ttl normalization', () => {
    beforeAll(async () => setupTestDB(), 60000);
    afterAll(async () => {
        await mongoose.connection.close();
        await mongoose.disconnect();
    });

    beforeEach(async () => {
        Container.reset();
        await applySpeedGooseCacheLayer(mongoose, { sharedCacheStrategy: SharedCacheStrategies.IN_MEMORY, defaultTtl: DEFAULT_TTL });
        await clearTestCache();
    });

    test.each([
        ['NaN', NaN, DEFAULT_TTL - 5, DEFAULT_TTL],
        ['Infinity', Infinity, DEFAULT_TTL - 5, DEFAULT_TTL],
        ['1.5 (rounded up to 2)', 1.5, 1.5, 2],
    ])('cacheQuery ttl %s stores a result that expires', async (label, ttl, min, max) => {
        const user = await UserModel.create({ name: `ttl-${label}` });
        const cacheKey = `invalid-ttl-query-${label}`;
        await UserModel.findById(user._id).lean().cacheQuery({ ttl, cacheKey });

        const remaining = await remainingResultTtl(cacheKey);
        expect(remaining).not.toBeNull();
        expect(remaining).toBeGreaterThan(min);
        expect(remaining).toBeLessThanOrEqual(max);
    });

    test('cachePipeline ttl NaN stores a result that expires', async () => {
        const cacheKey = 'invalid-ttl-aggregate-NaN';
        await UserModel.aggregate([{ $match: {} }]).cachePipeline({ ttl: NaN, cacheKey });

        const remaining = await remainingResultTtl(cacheKey);
        expect(remaining).not.toBeNull();
        expect(remaining).toBeGreaterThan(DEFAULT_TTL - 5);
        expect(remaining).toBeLessThanOrEqual(DEFAULT_TTL);
    });

    test('ttl 0 still bypasses the cache', async () => {
        const user = await UserModel.create({ name: 'ttl-0' });
        const cacheKey = 'invalid-ttl-query-zero';
        await UserModel.findById(user._id).lean().cacheQuery({ ttl: 0, cacheKey });

        expect(await getCacheStrategyInstance().getValueFromCache('resultsNamespace', cacheKey)).toBeNull();
    });
});
