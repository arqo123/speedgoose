/**
 * Regression test for unbounded growth of invalidation sets in Redis.
 *
 * Scenario: a cross-tenant query (`tenantId: [many tenant ids]`) runs periodically with a
 * filter value that changes on every run, so every run produces a new, never-hit cache key.
 * Results expire after `defaultTtl`, but the model/record invalidation sets used to keep
 * growing until Redis hit maxmemory:
 *  - every write refreshed the set TTL (sliding), so sets never expired,
 *  - members of expired results were never removed,
 *  - members were full JSON cache keys (tens of KB each),
 *  - the model set key was built from the whole tenant array, so create/delete of a
 *    tenant document never cleared it.
 *
 * Needs a real Redis (MEMORY USAGE, Lua) - run with `REDIS_URI=redis://localhost:6379 yarn test:redis`.
 * SPEEDGOOSE_ENTRY can point at another build (e.g. an unpacked npm release) to compare versions.
 */
import mongoose, { Schema, Types } from 'mongoose';
import Redis from 'ioredis';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Container from 'typedi';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const speedgoose = require(process.env.SPEEDGOOSE_ENTRY ?? '../../index');

const REDIS_URI = process.env.REDIS_URI;
const describeWithRedis = REDIS_URI ? describe : describe.skip;

const TENANTS = Array.from({ length: 200 }, () => new Types.ObjectId());
const TICKS = 30;
const TICK_MS = 250;
const DEFAULT_TTL = 1;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ioredis keyPrefix applies to KEYS[] of a Lua script, not to keys the script builds itself.
describeWithRedis.each(['', 'sg:'])('invalidation sets stay bounded on real Redis (keyPrefix %p)', keyPrefix => {
    const modelName = `InvalidationSetsRegression${keyPrefix ? 'Prefixed' : ''}`;
    let redis: Redis;
    let mongoServer: MongoMemoryServer;
    let TestModel: mongoose.Model<any>;

    const listSetKeys = async (): Promise<string[]> => {
        const keys = await redis.keys('*');
        const types = await Promise.all(keys.map(key => redis.type(key)));
        return keys.filter((_, i) => types[i] === 'set' || types[i] === 'zset');
    };

    const cardinality = async (key: string): Promise<number> => ((await redis.type(key)) === 'zset' ? redis.zcard(key) : redis.scard(key));

    const setsStats = async () => {
        const keys = await listSetKeys();
        const cards = await Promise.all(keys.map(cardinality));
        const memory = await Promise.all(keys.map(key => redis.memory('USAGE', key) as Promise<number>));
        return {
            keys,
            maxCardinality: Math.max(0, ...cards),
            totalMemory: memory.reduce((sum, value) => sum + (value ?? 0), 0),
        };
    };

    // Model invalidation sets left for this model (`<Model>_<tenant>`); create/delete must clear every one a query was put in.
    const modelSetKeys = async (): Promise<string[]> => redis.keys(`${keyPrefix}${modelName}_*`);

    const runTick = (tick: number) =>
        TestModel.find({
            tenantId: TENANTS,
            $or: [{ 'settings.slot': `tick-${tick}` }, { kind: 'shared' }],
        })
            .lean()
            .cacheQuery();

    beforeAll(async () => {
        redis = new Redis(REDIS_URI);
        await redis.flushdb();

        mongoServer = await MongoMemoryServer.create();
        await mongoose.connect(mongoServer.getUri());

        const schema = new Schema({ tenantId: Schema.Types.ObjectId, kind: String, settings: { slot: String } });
        schema.plugin(speedgoose.SpeedGooseCacheAutoCleaner);
        TestModel = mongoose.model(modelName, schema);

        Container.reset();
        await speedgoose.applySpeedGooseCacheLayer(mongoose, {
            redisUri: REDIS_URI,
            redisOptions: { keyPrefix },
            multitenancyConfig: { multitenantKey: 'tenantId' },
            defaultTtl: DEFAULT_TTL,
        });

        await TestModel.create([
            { tenantId: TENANTS[0], kind: 'shared' },
            { tenantId: TENANTS[1], kind: 'shared' },
            { tenantId: TENANTS[2], kind: 'shared' },
        ]);
    });

    afterAll(async () => {
        await redis.flushdb();
        await redis.quit();
        await mongoose.disconnect();
        await mongoServer.stop();
    });

    test('a never-hit query running more often than setsTtl does not grow the sets', async () => {
        for (let tick = 0; tick < TICKS / 2; tick++) {
            await runTick(tick);
            await sleep(TICK_MS);
        }
        const halfway = await setsStats();

        for (let tick = TICKS / 2; tick < TICKS; tick++) {
            await runTick(tick);
            await sleep(TICK_MS);
        }
        const end = await setsStats();

        // Results live DEFAULT_TTL seconds, so only ~DEFAULT_TTL*1000/TICK_MS of them are alive at a time.
        const liveResults = Math.ceil((DEFAULT_TTL * 1000) / TICK_MS) + 1;
        expect(end.maxCardinality).toBeLessThanOrEqual(liveResults * 2);
        expect(end.totalMemory).toBeLessThanOrEqual(halfway.totalMemory * 1.5);
        // Members must not carry the full query: 4 sets (model + 3 records) x a handful of members.
        expect(end.totalMemory).toBeLessThan(64 * 1024);
    });

    const crossTenantCases: Array<[string, (kind: string) => Record<string, unknown>]> = [
        ['tenant array', kind => ({ tenantId: TENANTS, kind })],
        ['$in', kind => ({ tenantId: { $in: TENANTS }, kind })],
    ];

    test.each(crossTenantCases)('creating a document of one tenant invalidates a cross-tenant cached query (%s)', async (label, filter) => {
        const kind = `create-${label}`;
        await TestModel.create([{ tenantId: TENANTS[0], kind }]);
        const query = () => TestModel.find(filter(kind)).lean().cacheQuery();

        expect(await query()).toHaveLength(1);
        // A second query written to the same model set runs the expired-members prune over the first one.
        await TestModel.find(filter(`${kind}-other`))
            .lean()
            .cacheQuery();
        await sleep(50);

        await TestModel.create({ tenantId: TENANTS[5], kind });
        await sleep(50);

        expect(await modelSetKeys()).toEqual([]);
        expect(await query()).toHaveLength(2);
    });

    test.each(crossTenantCases)('deleting a document of one tenant invalidates a cross-tenant cached query (%s)', async (label, filter) => {
        const kind = `delete-${label}`;
        await TestModel.create([
            { tenantId: TENANTS[0], kind },
            { tenantId: TENANTS[7], kind },
        ]);
        const query = () => TestModel.find(filter(kind)).lean().cacheQuery();

        expect(await query()).toHaveLength(2);
        await TestModel.find(filter(`${kind}-other`))
            .lean()
            .cacheQuery();
        await sleep(50);

        await TestModel.deleteOne({ tenantId: TENANTS[7], kind });
        await sleep(50);

        expect(await modelSetKeys()).toEqual([]);
        expect(await query()).toHaveLength(1);
    });
});
