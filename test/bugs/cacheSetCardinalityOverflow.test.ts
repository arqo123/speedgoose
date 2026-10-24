/**
 * Regression: reaching maxSetCardinality dropped the whole invalidation set while the results it
 * indexed stayed cached, so a later invalidation of that model/record could not reach them.
 * Document tracking sets (`docCacheSets:<id>`) ignored maxSetCardinality entirely.
 * Expected: overflowing members are evicted AND their cached values deleted; after invalidation no
 * previously cached value of that set is readable.
 * IN_MEMORY strategy (real-Redis variant: test/redis/auditRedis.redis.test.ts).
 */
import mongoose from 'mongoose';
import Container from 'typedi';
import { applySpeedGooseCacheLayer } from '../../src/wrapper';
import { CachedResult, SharedCacheStrategies } from '../../src/types/types';
import { getCacheStrategyInstance } from '../../src/utils/commonUtils';
import { clearTestCache } from '../testUtils';

const value = (v: unknown) => ({ v }) as unknown as CachedResult<unknown>;

describe('cache set cardinality overflow (in-memory)', () => {
    beforeEach(async () => {
        Container.reset();
        await applySpeedGooseCacheLayer(mongoose, { sharedCacheStrategy: SharedCacheStrategies.IN_MEMORY, maxSetCardinality: 5 });
        await clearTestCache();
    });

    const readableResults = async (keys: string[]) => (await Promise.all(keys.map(key => getCacheStrategyInstance().getValueFromCache('resultsNamespace', key)))).filter(Boolean).length;

    test('model set: no previously cached result survives invalidation after overflow', async () => {
        const strategy = getCacheStrategyInstance();
        const keys = Array.from({ length: 8 }, (_, i) => `overflow-model-${i}`);
        for (const key of keys) {
            await strategy.addValueToCache('resultsNamespace', key, value(key), 600);
            await strategy.addValueToCacheSet('OverflowModel_', key, 1200, 3);
        }
        expect((await strategy.getValuesFromCachedSet('OverflowModel_')).length).toBeLessThanOrEqual(3);

        await strategy.clearResultsCacheWithSet('OverflowModel_');
        expect(await readableResults(keys)).toBe(0);
    });

    test('record sets: no previously cached result survives invalidation after overflow', async () => {
        const strategy = getCacheStrategyInstance();
        const keys = Array.from({ length: 8 }, (_, i) => `overflow-record-${i}`);
        for (const key of keys) {
            await strategy.addValueToCache('resultsNamespace', key, value(key), 600);
            await strategy.addValueToManyCachedSets(['overflowRecA', 'overflowRecB'], key, 1200, 3);
        }
        for (const recordSet of ['overflowRecA', 'overflowRecB']) {
            expect((await strategy.getValuesFromCachedSet(recordSet)).length).toBeLessThanOrEqual(3);
            await strategy.clearResultsCacheWithSet(recordSet);
        }
        expect(await readableResults(keys)).toBe(0);
    });

    test('document tracking set honors maxSetCardinality and evicted variants are still invalidated', async () => {
        const strategy = getCacheStrategyInstance();
        const docKeys = Array.from({ length: 20 }, (_, i) => `doc:OverflowDoc:r1:select:f${i}`);
        for (const key of docKeys) {
            await strategy.setDocuments(new Map([[key, value(key)]]), 600);
        }
        expect((await strategy.getValuesFromCachedSet('docCacheSets:r1')).length).toBeLessThanOrEqual(5);

        await strategy.clearDocumentsCache('r1');
        expect((await strategy.getDocuments(docKeys)).size).toBe(0);
    });
});
