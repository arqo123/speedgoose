/**
 * Regression: the IN_MEMORY strategy (and the per-process hydration caches) used Keyv 4 with its
 * default `Map` store. Keyv only drops an expired entry when that exact key is read again, so
 * never-revisited keys (unique query keys, one-off projections) stayed in the heap forever, and
 * `Keyv.has()` (used by `isCached()`) answered `true` for expired entries.
 */
import mongoose, { Schema, Types } from 'mongoose';
import Container from 'typedi';
import Keyv from 'keyv';
import { applySpeedGooseCacheLayer } from '../../src/wrapper';
import { SpeedGooseCacheAutoCleaner } from '../../src/plugin/SpeedGooseCacheAutoCleaner';
import { SharedCacheStrategies } from '../../src/types/types';
import { getCacheStrategyInstance } from '../../src/utils/commonUtils';
import { createInMemoryCacheClientWithNamespace } from '../../src/utils/cacheClientUtils';
import { setupTestDB } from '../testUtils';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Number of entries physically held by a Keyv client's underlying store (expired or not). */
const storeSize = (client: Keyv<any>): number => {
    const size = (client as any).opts.store.size;
    expect(typeof size).toBe('number');
    return size;
};

/** Largest cardinality of any Set value held by a Keyv client's underlying store. */
const maxSetCardinality = (client: Keyv<any>): number => {
    let max = 0;
    for (const raw of (client as any).opts.store.values()) {
        const value = raw?.value ?? raw;
        if (value instanceof Set) max = Math.max(max, value.size);
    }
    return max;
};

const TENANTS = Array.from({ length: 50 }, () => new Types.ObjectId());
const PeriodicQuerySchema = new Schema({ tenantId: Schema.Types.ObjectId, kind: String, slot: String });
PeriodicQuerySchema.plugin(SpeedGooseCacheAutoCleaner);
const PeriodicQueryModel = mongoose.model('InMemoryHeapGrowthPeriodic', PeriodicQuerySchema);

describe('IN_MEMORY: expired entries do not stay in the process heap', () => {
    beforeAll(async () => setupTestDB());
    afterAll(async () => {
        await mongoose.connection.close();
        await mongoose.disconnect();
    });

    it('removes expired, never-read entries from the underlying store once further writes happen', async () => {
        const client = createInMemoryCacheClientWithNamespace<{ payload: string }>('heapGrowth');
        for (let i = 0; i < 1000; i++) {
            await client.set(`key-${i}`, { payload: 'x'.repeat(100) }, 10);
        }
        expect(storeSize(client)).toBe(1000);

        // A timed sweep runs a second after the last one, once writes reach a tenth of the store size.
        await sleep(1100);
        for (let i = 0; i < 150; i++) {
            await client.set(`later-${i}`, { payload: 'y' }, 60_000);
        }
        await sleep(200);

        // Only the 150 live entries may remain; the 1000 expired ones must be gone.
        expect(storeSize(client)).toBeLessThanOrEqual(150);
    });

    it('isCached() returns false once the cached result has expired', async () => {
        Container.reset();
        await applySpeedGooseCacheLayer(mongoose, { sharedCacheStrategy: SharedCacheStrategies.IN_MEMORY });
        await PeriodicQueryModel.deleteMany({});
        await PeriodicQueryModel.create({ tenantId: TENANTS[0], kind: 'isCached' });

        const query = () => PeriodicQueryModel.find({ kind: 'isCached' }).lean();
        await query().cacheQuery({ ttl: 1 });
        expect(await query().isCached({ ttl: 1 })).toBe(true);

        await sleep(1600);
        expect(await query().isCached({ ttl: 1 })).toBe(false);
    });

    it('periodic never-hit cross-tenant query every 250ms (defaultTtl 1) keeps results store and index sets bounded', async () => {
        Container.reset();
        await applySpeedGooseCacheLayer(mongoose, {
            sharedCacheStrategy: SharedCacheStrategies.IN_MEMORY,
            multitenancyConfig: { multitenantKey: 'tenantId' },
            defaultTtl: 1,
        });
        await PeriodicQueryModel.deleteMany({});
        await PeriodicQueryModel.create([
            { tenantId: TENANTS[0], kind: 'shared' },
            { tenantId: TENANTS[1], kind: 'shared' },
            { tenantId: TENANTS[2], kind: 'shared' },
        ]);

        const strategy = getCacheStrategyInstance() as any;
        const resultsClient: Keyv<any> = strategy.resultsCacheClient;
        const setsClient: Keyv<any> = strategy.recordResultsSetsClient;
        expect(resultsClient).toBeDefined();
        expect(setsClient).toBeDefined();

        const TICKS = 30;
        const runTick = (tick: number) =>
            PeriodicQueryModel.find({ tenantId: TENANTS, $or: [{ slot: `tick-${tick}` }, { kind: 'shared' }] })
                .lean()
                .cacheQuery();

        let halfway = { results: 0, maxSet: 0 };
        for (let tick = 0; tick < TICKS; tick++) {
            const rows = await runTick(tick);
            expect(rows).toHaveLength(3);
            await sleep(250);
            if (tick === TICKS / 2 - 1) halfway = { results: storeSize(resultsClient), maxSet: maxSetCardinality(setsClient) };
        }
        const end = { results: storeSize(resultsClient), maxSet: maxSetCardinality(setsClient) };

        // Results live 1s, a tick is 250ms -> ~5 alive at a time. Linear growth would reach 30.
        const liveResults = Math.ceil(1000 / 250) + 1;
        expect(end.results).toBeLessThanOrEqual(liveResults * 2);
        expect(end.maxSet).toBeLessThanOrEqual(liveResults * 2);
        expect(end.results).toBeLessThanOrEqual(Math.max(halfway.results, liveResults) * 1.5);
    }, 30_000);
});
