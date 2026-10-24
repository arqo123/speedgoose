/**
 * Regression tests for the cache-invalidation audit, against a real Redis.
 *
 * Covers: document deletion with an ioredis keyPrefix and with more tracked variants than Lua's
 * `unpack` limit (~8000), document tracking pruning + maxSetCardinality, cardinality overflow
 * leaving results that can no longer be invalidated, invalidation sets expiring before the results
 * they index, invalid ttl values creating results without expiry, `{ tenant: null }` queries and
 * parent ids containing a colon.
 *
 * Needs a real Redis (Lua, TTLs) - run with `REDIS_URI=redis://localhost:6379/14 yarn test:redis`.
 * The suite flushes the selected database, so REDIS_URI must name a non-default db index reserved for it.
 */
import mongoose, { Schema, Types } from 'mongoose';
import Redis from 'ioredis';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Container from 'typedi';
import * as speedgoose from '../../index';
import { RedisStrategy } from '../../src/cachingStrategies/redisStrategy';
import { CachedResult, GlobalDiContainerRegistryNames } from '../../src/types/types';

const REDIS_URI = process.env.REDIS_URI;
if (REDIS_URI && !(Number(new URL(REDIS_URI).pathname.slice(1)) > 0)) {
    throw new Error(`REDIS_URI must select a dedicated db index other than 0 (e.g. redis://localhost:6379/14), got ${REDIS_URI}`);
}
const describeWithRedis = REDIS_URI ? describe : describe.skip;

const KEY_PREFIXES = ['', 'app:'];
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const value = (v: unknown) => ({ v }) as unknown as CachedResult<unknown>;

describeWithRedis('cache invalidation audit on real Redis', () => {
    let raw: Redis;
    let mongoServer: MongoMemoryServer;

    beforeAll(async () => {
        raw = new Redis(REDIS_URI);
        await raw.flushdb();
        mongoServer = await MongoMemoryServer.create();
        await mongoose.connect(mongoServer.getUri());
    });

    afterAll(async () => {
        await raw.flushdb();
        await raw.quit();
        await mongoose.disconnect();
        await mongoServer.stop();
    });

    describe.each(KEY_PREFIXES)('RedisStrategy (keyPrefix %p)', keyPrefix => {
        let strategy: RedisStrategy | undefined;
        const k = (key: string) => `${keyPrefix}${key}`;

        const registerStrategy = async (config: Record<string, unknown> = {}): Promise<RedisStrategy> => {
            Container.reset();
            Container.set(GlobalDiContainerRegistryNames.CONFIG_GLOBAL_ACCESS, { redisUri: REDIS_URI, redisOptions: { keyPrefix }, defaultTtl: 60, ...config });
            await RedisStrategy.register();
            strategy = Container.get<RedisStrategy>(GlobalDiContainerRegistryNames.CACHE_CLIENT_GLOBAL_ACCESS);
            return strategy;
        };

        afterEach(async () => {
            await strategy?.client.quit();
            strategy = undefined;
        });

        describe('clearDocumentsCache', () => {
            test('deletes every tracked document variant and its tracking set', async () => {
                const s = await registerStrategy();
                const docKeys = ['doc:AuditDoc:r1', 'doc:AuditDoc:r1:select:name'];
                await s.setDocuments(new Map(docKeys.map(key => [key, value(key)])), 600);
                expect((await s.getDocuments(docKeys)).size).toBe(2);

                await s.clearDocumentsCache('r1');

                expect((await s.getDocuments(docKeys)).size).toBe(0);
                expect(await raw.exists(...docKeys.map(k))).toBe(0);
                expect(await raw.exists(k('docCacheSets:r1'))).toBe(0);
            });

            test('does not delete keys outside the configured keyPrefix', async () => {
                const s = await registerStrategy();
                const foreignKey = keyPrefix ? 'doc:AuditDoc:foreign' : 'other:doc:AuditDoc:foreign';
                await raw.set(foreignKey, 'belongs to another app');
                await s.setDocuments(new Map([['doc:AuditDoc:foreign', value(1)]]), 600);

                await s.clearDocumentsCache('foreign');

                expect(await raw.get(foreignKey)).toBe('belongs to another app');
            });

            test('deletes more tracked variants than Lua can unpack at once (>8000)', async () => {
                const s = await registerStrategy({ maxSetCardinality: 0 });
                const docKeys = Array.from({ length: 9000 }, (_, i) => `doc:AuditDoc:big:select:f${i}`);
                await s.setDocuments(new Map(docKeys.map(key => [key, value(1)])), 600);
                expect(await raw.exists(...docKeys.map(k))).toBe(9000);

                await expect(s.clearDocumentsCache('big')).resolves.not.toThrow();

                expect(await raw.exists(...docKeys.map(k))).toBe(0);
                expect(await raw.exists(k('docCacheSets:big'))).toBe(0);
            });
        });

        describe('document tracking sets', () => {
            test('honor maxSetCardinality, and evicted variants are still invalidated', async () => {
                const s = await registerStrategy({ maxSetCardinality: 5 });
                const docKeys = Array.from({ length: 20 }, (_, i) => `doc:AuditDoc:r2:select:f${i}`);
                for (const key of docKeys) {
                    await s.setDocuments(new Map([[key, value(key)]]), 600);
                }

                expect(await raw.scard(k('docCacheSets:r2'))).toBeLessThanOrEqual(5);

                await s.clearDocumentsCache('r2');
                expect((await s.getDocuments(docKeys)).size).toBe(0);
            });

            test('drop members whose document already expired', async () => {
                const s = await registerStrategy({ maxSetCardinality: 0, setsTtl: 60 });
                for (let i = 0; i < 12; i++) {
                    await s.setDocuments(new Map([[`doc:AuditDoc:r2b:select:dead${i}`, value(i)]]), 1);
                }
                await sleep(2500);
                for (let i = 0; i < 12; i++) {
                    await s.setDocuments(new Map([[`doc:AuditDoc:r2b:select:live${i}`, value(i)]]), 600);
                }

                // 12 dead + 12 live without pruning.
                expect(await raw.scard(k('docCacheSets:r2b'))).toBeLessThan(24);
            });

            test('TTL never shrinks when a shorter-lived variant is added', async () => {
                const s = await registerStrategy();
                await s.setDocuments(new Map([['doc:AuditDoc:r5:select:long', value(1)]]), 3600);
                await s.setDocuments(new Map([['doc:AuditDoc:r5:select:short', value(1)]]), 10);

                expect(await raw.ttl(k('docCacheSets:r5'))).toBeGreaterThanOrEqual(3000);
            });

            test('setsTtl 0 still means no expiry', async () => {
                const s = await registerStrategy({ setsTtl: 0 });
                await s.setDocuments(new Map([['doc:AuditDoc:r5b', value(1)]]), 60);

                expect(await raw.ttl(k('docCacheSets:r5b'))).toBe(-1);
            });
        });

        describe('result invalidation sets', () => {
            const cacheResults = async (s: RedisStrategy, keys: string[]) => {
                for (const key of keys) await s.addValueToCache('resultsNamespace', key, value(key), 600);
            };
            const readableResults = async (s: RedisStrategy, keys: string[]) => (await Promise.all(keys.map(key => s.getValueFromCache('resultsNamespace', key)))).filter(Boolean).length;

            test('on cardinality overflow no previously cached result of a model set stays un-invalidatable', async () => {
                const s = await registerStrategy();
                const keys = Array.from({ length: 6 }, (_, i) => `audit4:model:k${i}`);
                await cacheResults(s, keys);
                for (const key of keys) await s.addValueToCacheSet('AuditOverflow_', key, 1200, 3);

                expect(await raw.scard(k('AuditOverflow_'))).toBeLessThanOrEqual(3);

                await s.clearResultsCacheWithSet('AuditOverflow_');
                expect(await readableResults(s, keys)).toBe(0);
            });

            test('on cardinality overflow no previously cached result of a record set stays un-invalidatable', async () => {
                const s = await registerStrategy();
                const keys = Array.from({ length: 6 }, (_, i) => `audit4:record:k${i}`);
                await cacheResults(s, keys);
                for (const key of keys) await s.addValueToManyCachedSets(['auditRecA', 'auditRecB'], key, 1200, 3);

                for (const recordSet of ['auditRecA', 'auditRecB']) {
                    expect(await raw.scard(k(recordSet))).toBeLessThanOrEqual(3);
                    await s.clearResultsCacheWithSet(recordSet);
                }
                expect(await readableResults(s, keys)).toBe(0);
            });

            test('TTL never shrinks when a later write passes a shorter ttl', async () => {
                const s = await registerStrategy();
                await s.addValueToCache('resultsNamespace', 'audit5:a', value(1), 600);
                await s.addValueToCache('resultsNamespace', 'audit5:b', value(1), 600);
                await s.addValueToCacheSet('AuditExtend_', 'audit5:a', 100, 0);
                await s.addValueToCacheSet('AuditExtend_', 'audit5:b', 10, 0);

                expect(await raw.ttl(k('AuditExtend_'))).toBeGreaterThanOrEqual(90);
            });

            test('setsTtl 0 still means no expiry', async () => {
                const s = await registerStrategy();
                await s.addValueToCache('resultsNamespace', 'audit5:c', value(1), 600);
                await s.addValueToCacheSet('AuditNoExpiry_', 'audit5:c', 0, 0);

                expect(await raw.ttl(k('AuditNoExpiry_'))).toBe(-1);
            });
        });
    });

    describe.each(KEY_PREFIXES)('through mongoose (keyPrefix %p)', keyPrefix => {
        const suffix = keyPrefix ? 'Prefixed' : '';
        let Item: mongoose.Model<any>;
        let Child: mongoose.Model<any>;
        let Parent: mongoose.Model<any>;

        beforeAll(async () => {
            const itemSchema = new Schema({ tenantId: String, name: String });
            itemSchema.plugin(speedgoose.SpeedGooseCacheAutoCleaner);
            Item = mongoose.model(`AuditItem${suffix}`, itemSchema);

            const childSchema = new Schema({ name: String });
            childSchema.plugin(speedgoose.SpeedGooseCacheAutoCleaner);
            Child = mongoose.model(`AuditChild${suffix}`, childSchema);

            const parentSchema = new Schema({ _id: String, child: { type: Schema.Types.ObjectId, ref: `AuditChild${suffix}` } });
            parentSchema.plugin(speedgoose.SpeedGooseCacheAutoCleaner);
            Parent = mongoose.model(`AuditParent${suffix}`, parentSchema);

            Container.reset();
            await speedgoose.applySpeedGooseCacheLayer(mongoose, {
                redisUri: REDIS_URI,
                redisOptions: { keyPrefix },
                multitenancyConfig: { multitenantKey: 'tenantId' },
                defaultTtl: 1, // setsTtl defaults to 2 seconds
            });
        });

        test('an updated populated document is not served from the document cache', async () => {
            const child = await Child.create({ name: 'v1' });
            const parent = await Parent.create({ _id: `p1${suffix}`, child: child._id });
            const query = () => Parent.findById(parent._id).lean().cachePopulate('child').cacheQuery({ ttl: 30 });
            expect((await query()).child.name).toBe('v1');

            await Child.updateOne({ _id: child._id }, { name: 'v2' });
            await sleep(100);

            expect((await query()).child.name).toBe('v2');
        });

        test('an update is seen for a query whose ttl is longer than setsTtl', async () => {
            const item = await Item.create({ tenantId: 't1', name: 'v1' });
            const query = () => Item.findById(item._id).lean().cacheQuery({ ttl: 30 });
            expect((await query()).name).toBe('v1');

            await sleep(3500);
            await Item.updateOne({ _id: item._id }, { name: 'v2' });
            await sleep(100);

            expect((await query()).name).toBe('v2');
        });

        test('an update is seen for a query kept alive by refreshTtlOnRead past setsTtl', async () => {
            const item = await Item.create({ tenantId: 't1', name: 'v1' });
            const query = () => Item.findById(item._id).lean().cacheQuery({ refreshTtlOnRead: true });
            expect((await query()).name).toBe('v1');

            for (let i = 0; i < 10; i++) {
                await sleep(400);
                await query();
            }
            await Item.updateOne({ _id: item._id }, { name: 'v2' });
            await sleep(100);

            expect((await query()).name).toBe('v2');
        });

        test.each([
            ['NaN', NaN, 1],
            ['Infinity', Infinity, 1],
            ['1.5', 1.5, 2],
        ])('ttl %s gives the result an expiry (ceil, or defaultTtl when not finite)', async (label, ttl, expectedSeconds) => {
            const item = await Item.create({ tenantId: 't6', name: `ttl-${label}` });
            const cacheKey = `audit6:${label}`;
            await Item.findById(item._id).lean().cacheQuery({ ttl, cacheKey });

            const pttl = await raw.pttl(`${keyPrefix}resultsNamespace:${cacheKey}`);
            expect(pttl).toBeGreaterThan((expectedSeconds - 1) * 1000);
            expect(pttl).toBeLessThanOrEqual(expectedSeconds * 1000);
        });

        test('aggregate ttl NaN gives the result an expiry', async () => {
            const cacheKey = 'audit6:aggregate-NaN';
            await Item.aggregate([{ $match: { tenantId: 't6' } }]).cachePipeline({ ttl: NaN, cacheKey });

            const pttl = await raw.pttl(`${keyPrefix}resultsNamespace:${cacheKey}`);
            expect(pttl).toBeGreaterThan(0);
            expect(pttl).toBeLessThanOrEqual(1000);
        });

        test('a { tenantId: null } query is invalidated by inserting a matching document', async () => {
            const name = `null-tenant-${new Types.ObjectId()}`;
            const query = () => Item.find({ tenantId: null, name }).lean().cacheQuery({ ttl: 30 });
            expect(await query()).toHaveLength(0);

            await Item.create({ tenantId: null, name });
            await sleep(100);
            expect(await query()).toHaveLength(1);

            await Item.create({ name });
            await sleep(100);
            expect(await query()).toHaveLength(2);
        });

        test.each([
            ['without a colon', 'plain'],
            ['containing colons', 'org:acme:42'],
        ])('a parent whose _id is %s is invalidated when its child changes', async (_label, idPart) => {
            const child = await Child.create({ name: 'v1' });
            const parentId = `${idPart}${suffix}`;
            await Parent.create({ _id: parentId, child: child._id });
            const cacheKey = `audit8:${parentId}`;
            await Parent.findById(parentId).lean().cachePopulate('child').cacheQuery({ ttl: 30, cacheKey });
            expect(await speedgoose.isCached(cacheKey)).toBe(true);

            await Child.updateOne({ _id: child._id }, { name: 'v2' });
            await sleep(100);

            expect(await speedgoose.isCached(cacheKey)).toBe(false);
        });
    });
});
