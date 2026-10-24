/**
 * Regressions in the refresh-TTL-on-read queue:
 *  - IN_MEMORY `refreshTTLForCachedResult` re-`set` the value captured at hit time, so a refresh that
 *    ran after an invalidation resurrected the stale result - with no tracking set left to clear it.
 *  - The "already scheduled" set was checked but never populated, so dedupe never activated.
 */
import mongoose from 'mongoose';
import Container from 'typedi';
import { applySpeedGooseCacheLayer } from '../../src/wrapper';
import { GlobalDiContainerRegistryNames, SharedCacheStrategies } from '../../src/types/types';
import { getCacheStrategyInstance } from '../../src/utils/commonUtils';
import { clearCacheForRecordId, getResultsFromCache } from '../../src/utils/cacheClientUtils';
import { scheduleTTlRefreshing } from '../../src/utils/queueUtils';
import { UserModel, clearTestCache, setupTestDB } from '../testUtils';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('refresh TTL on read', () => {
    beforeAll(async () => setupTestDB());
    afterAll(async () => {
        await mongoose.connection.close();
        await mongoose.disconnect();
    });

    beforeEach(async () => {
        Container.reset();
        await applySpeedGooseCacheLayer(mongoose, { sharedCacheStrategy: SharedCacheStrategies.IN_MEMORY, refreshTtlOnRead: true });
        await clearTestCache();
        await UserModel.deleteMany({});
    });

    it('IN_MEMORY: a refresh queued by a hit does not resurrect a result invalidated before it ran', async () => {
        const user = await UserModel.create({ name: 'old', email: 'e' });
        const read = async () => (await UserModel.findById(user._id).lean().cacheQuery({ ttl: 600, cacheKey: 'refresh-resurrect' })) as any;

        await read(); // miss -> cached
        await read(); // hit -> schedules a refresh (setTimeout 0) holding the hit value
        await clearCacheForRecordId(String(user._id)); // invalidation completes before the refresh runs
        expect(await getResultsFromCache('refresh-resurrect')).toBeNull();

        await sleep(100); // refresh runs
        expect(await getResultsFromCache('refresh-resurrect')).toBeNull();

        await UserModel.updateOne({ _id: user._id }, { name: 'new' });
        await sleep(100);
        expect((await read()).name).toBe('new');
    });

    it('dedupes refreshes scheduled for the same key', async () => {
        const strategy = getCacheStrategyInstance();
        const refreshSpy = jest.spyOn(strategy, 'refreshTTLForCachedResult');
        const context: any = { cacheKey: 'refresh-dedupe', ttl: 60, debug: () => {} };

        await Promise.all(Array.from({ length: 50 }, () => scheduleTTlRefreshing(context, { some: 'value' } as any)));
        await sleep(50);

        expect(refreshSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
        expect(refreshSpy.mock.calls.length).toBeLessThanOrEqual(5);

        // The key is released once its refresh finished, so a later hit can refresh again.
        const scheduled = Container.get<Set<string>>(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_SETS_QUEUE_ACCESS);
        expect(scheduled.has('refresh-dedupe')).toBe(false);
    });
});
