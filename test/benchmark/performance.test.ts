import mongoose, { Schema, Model, Document } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Container from 'typedi';
import { applySpeedGooseCacheLayer } from '../../src/wrapper';
import { SpeedGooseCacheAutoCleaner } from '../../src/plugin/SpeedGooseCacheAutoCleaner';
import { SharedCacheStrategies } from '../../src/types/types';
import { clearAllCaches } from '../../src/utils/cacheUtils';

jest.setTimeout(120000);

// ─── Types ───────────────────────────────────────────────────────────────────

interface IBenchUser extends Document {
    name: string;
    email: string;
    age: number;
    createdAt: Date;
}

interface IBenchPost extends Document {
    title: string;
    content: string;
    author: IBenchUser | mongoose.Types.ObjectId;
    reviewer: IBenchUser | mongoose.Types.ObjectId;
    editor: IBenchUser | mongoose.Types.ObjectId;
    contributors: (IBenchUser | mongoose.Types.ObjectId)[];
    tags: string[];
    createdAt: Date;
}

interface BenchmarkStats {
    ops_per_sec: number;
    avg_ms: number;
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
    min_ms: number;
    max_ms: number;
}

// ─── Statistics helper ───────────────────────────────────────────────────────

function computeStats(timingsNs: bigint[]): BenchmarkStats {
    if (timingsNs.length === 0) {
        return { ops_per_sec: 0, avg_ms: 0, p50_ms: 0, p95_ms: 0, p99_ms: 0, min_ms: 0, max_ms: 0 };
    }

    const sorted = [...timingsNs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const toMs = (ns: bigint) => Number(ns) / 1_000_000;

    const sum = sorted.reduce((acc, v) => acc + v, 0n);
    const avg_ms = toMs(sum / BigInt(sorted.length));
    const p50_ms = toMs(sorted[Math.floor(sorted.length * 0.5)]);
    const p95_ms = toMs(sorted[Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1)]);
    const p99_ms = toMs(sorted[Math.min(Math.floor(sorted.length * 0.99), sorted.length - 1)]);
    const min_ms = toMs(sorted[0]);
    const max_ms = toMs(sorted[sorted.length - 1]);
    const ops_per_sec = avg_ms > 0 ? Math.round(1000 / avg_ms) : 0;

    return { ops_per_sec, avg_ms: round(avg_ms), p50_ms: round(p50_ms), p95_ms: round(p95_ms), p99_ms: round(p99_ms), min_ms: round(min_ms), max_ms: round(max_ms) };
}

function round(n: number, decimals = 3): number {
    const f = Math.pow(10, decimals);
    return Math.round(n * f) / f;
}

// ─── Pretty-print helper ────────────────────────────────────────────────────

function printBenchmarkPair(label: string, uncachedStats: BenchmarkStats, cachedStats: BenchmarkStats): void {
    const speedup = uncachedStats.avg_ms > 0 && cachedStats.avg_ms > 0 ? round(uncachedStats.avg_ms / cachedStats.avg_ms, 1) : 0;

    const rows = [
        { Benchmark: `${label} (uncached)`, 'Avg (ms)': uncachedStats.avg_ms, 'P95 (ms)': uncachedStats.p95_ms, 'Ops/sec': uncachedStats.ops_per_sec, Speedup: '-' },
        { Benchmark: `${label} (cached)`, 'Avg (ms)': cachedStats.avg_ms, 'P95 (ms)': cachedStats.p95_ms, 'Ops/sec': cachedStats.ops_per_sec, Speedup: `${speedup}x` },
    ];

    console.log(`\n--- ${label} ---`);
    console.table(rows);
}

function printSingleBenchmark(label: string, stats: BenchmarkStats): void {
    console.log(`\n--- ${label} ---`);
    console.table([{ Benchmark: label, 'Avg (ms)': stats.avg_ms, 'P95 (ms)': stats.p95_ms, 'Ops/sec': stats.ops_per_sec }]);
}

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('Performance Benchmarks', () => {
    let mongoServer: MongoMemoryServer;
    let BenchUser: Model<IBenchUser>;
    let BenchPost: Model<IBenchPost>;
    let userIds: mongoose.Types.ObjectId[] = [];
    let userNames: string[] = [];

    const SEED_USERS = 500;
    const SEED_POSTS = 1000;
    const WARMUP_ITERATIONS = 5;
    const TAGS = ['tech', 'science', 'sports', 'music', 'art', 'travel', 'food', 'health', 'finance', 'education'];

    beforeAll(async () => {
        // Start in-memory MongoDB
        mongoServer = await MongoMemoryServer.create();
        const uri = mongoServer.getUri();

        // Connect mongoose (disconnect first if already connected from global setup)
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
        await mongoose.connect(uri);

        // Reset DI container and apply cache layer
        Container.reset();
        await applySpeedGooseCacheLayer(mongoose, {
            sharedCacheStrategy: SharedCacheStrategies.IN_MEMORY,
            debugConfig: { enabled: false },
            defaultTtl: 300,
        });

        // Define schemas with auto-cleaner plugin
        const benchUserSchema = new Schema<IBenchUser>({
            name: { type: String, required: true, index: true },
            email: { type: String, required: true },
            age: { type: Number, required: true },
            createdAt: { type: Date, default: Date.now },
        });
        benchUserSchema.plugin(SpeedGooseCacheAutoCleaner);

        const benchPostSchema = new Schema<IBenchPost>({
            title: { type: String, required: true },
            content: { type: String, required: true },
            author: { type: Schema.Types.ObjectId, ref: 'BenchUser', required: true, index: true },
            reviewer: { type: Schema.Types.ObjectId, ref: 'BenchUser', index: true },
            editor: { type: Schema.Types.ObjectId, ref: 'BenchUser', index: true },
            contributors: [{ type: Schema.Types.ObjectId, ref: 'BenchUser' }],
            tags: [{ type: String }],
            createdAt: { type: Date, default: Date.now },
        });
        benchPostSchema.plugin(SpeedGooseCacheAutoCleaner);

        BenchUser = mongoose.models['BenchUser'] ?? mongoose.model<IBenchUser>('BenchUser', benchUserSchema);
        BenchPost = mongoose.models['BenchPost'] ?? mongoose.model<IBenchPost>('BenchPost', benchPostSchema);

        // Seed data
        console.log(`Seeding ${SEED_USERS} users and ${SEED_POSTS} posts...`);
        const seedStart = process.hrtime.bigint();

        const userDocs = [];
        for (let i = 0; i < SEED_USERS; i++) {
            userDocs.push({
                name: `User_${i}`,
                email: `user${i}@bench.test`,
                age: 18 + (i % 60),
            });
        }
        const insertedUsers = await BenchUser.insertMany(userDocs);
        userIds = insertedUsers.map(u => u._id as mongoose.Types.ObjectId);
        userNames = insertedUsers.map(u => u.name);

        const postDocs = [];
        for (let i = 0; i < SEED_POSTS; i++) {
            const authorIdx = i % SEED_USERS;
            const reviewerIdx = (i + 1) % SEED_USERS;
            const editorIdx = (i + 2) % SEED_USERS;
            const contribCount = 1 + (i % 3); // 1-3 contributors
            const contributors = [];
            for (let c = 0; c < contribCount; c++) {
                contributors.push(userIds[(i + 3 + c) % SEED_USERS]);
            }
            const tagCount = 1 + (i % 4);
            const postTags = [];
            for (let t = 0; t < tagCount; t++) {
                postTags.push(TAGS[(i + t) % TAGS.length]);
            }
            postDocs.push({
                title: `Post Title ${i}`,
                content: `This is the content of post number ${i}. It contains enough text to be realistic.`,
                author: userIds[authorIdx],
                reviewer: userIds[reviewerIdx],
                editor: userIds[editorIdx],
                contributors,
                tags: postTags,
            });
        }
        await BenchPost.insertMany(postDocs);

        const seedElapsed = Number(process.hrtime.bigint() - seedStart) / 1_000_000;
        console.log(`Seeding completed in ${round(seedElapsed)}ms`);
    }, 60000);

    afterAll(async () => {
        await mongoose.disconnect();
        await mongoServer.stop();
    });

    async function clearCache(): Promise<void> {
        await clearAllCaches();
    }

    // ─── Benchmark 1: findOne — uncached vs cached ─────────────────────────

    it('findOne — uncached vs cached', async () => {
        const iterations = 50;

        // --- Uncached ---
        await clearCache();
        // Warmup
        for (let i = 0; i < WARMUP_ITERATIONS; i++) {
            await BenchUser.findOne({ name: userNames[i % userNames.length] });
        }

        const uncachedTimings: bigint[] = [];
        for (let i = 0; i < iterations; i++) {
            const name = userNames[i % userNames.length];
            const start = process.hrtime.bigint();
            await BenchUser.findOne({ name });
            uncachedTimings.push(process.hrtime.bigint() - start);
        }

        // --- Cached ---
        await clearCache();
        // Warmup (cold cache fills)
        for (let i = 0; i < WARMUP_ITERATIONS; i++) {
            await (BenchUser.findOne({ name: userNames[i % userNames.length] }) as any).cacheQuery();
        }

        const cachedTimings: bigint[] = [];
        for (let i = 0; i < iterations; i++) {
            const name = userNames[i % WARMUP_ITERATIONS]; // reuse warmed-up queries
            const start = process.hrtime.bigint();
            await (BenchUser.findOne({ name }) as any).cacheQuery();
            cachedTimings.push(process.hrtime.bigint() - start);
        }

        const uncachedStats = computeStats(uncachedTimings);
        const cachedStats = computeStats(cachedTimings);
        printBenchmarkPair('findOne', uncachedStats, cachedStats);

        // Cached should be faster on average
        expect(cachedStats.avg_ms).toBeLessThan(uncachedStats.avg_ms);
    }, 60000);

    // ─── Benchmark 2: find (multiple results) — uncached vs cached ─────────

    it('find (multiple results) — uncached vs cached', async () => {
        const iterations = 50;

        // --- Uncached ---
        await clearCache();
        // Warmup
        for (let i = 0; i < WARMUP_ITERATIONS; i++) {
            await BenchPost.find({ author: userIds[i % userIds.length] }).limit(20);
        }

        const uncachedTimings: bigint[] = [];
        for (let i = 0; i < iterations; i++) {
            const userId = userIds[i % userIds.length];
            const start = process.hrtime.bigint();
            await BenchPost.find({ author: userId }).limit(20);
            uncachedTimings.push(process.hrtime.bigint() - start);
        }

        // --- Cached ---
        await clearCache();
        // Warmup (cold cache fills)
        for (let i = 0; i < WARMUP_ITERATIONS; i++) {
            await (BenchPost.find({ author: userIds[i % userIds.length] }).limit(20) as any).cacheQuery();
        }

        const cachedTimings: bigint[] = [];
        for (let i = 0; i < iterations; i++) {
            const userId = userIds[i % WARMUP_ITERATIONS]; // reuse warmed-up queries
            const start = process.hrtime.bigint();
            await (BenchPost.find({ author: userId }).limit(20) as any).cacheQuery();
            cachedTimings.push(process.hrtime.bigint() - start);
        }

        const uncachedStats = computeStats(uncachedTimings);
        const cachedStats = computeStats(cachedTimings);
        printBenchmarkPair('find (multi)', uncachedStats, cachedStats);

        expect(cachedStats.avg_ms).toBeLessThan(uncachedStats.avg_ms);
    }, 60000);

    // ─── Benchmark 3: Aggregate pipeline — uncached vs cached ──────────────

    it('aggregate pipeline — uncached vs cached', async () => {
        const iterations = 30;
        const pipeline = [{ $group: { _id: '$author', count: { $sum: 1 } } }];

        // --- Uncached ---
        await clearCache();
        // Warmup
        for (let i = 0; i < WARMUP_ITERATIONS; i++) {
            await BenchPost.aggregate(pipeline);
        }

        const uncachedTimings: bigint[] = [];
        for (let i = 0; i < iterations; i++) {
            const start = process.hrtime.bigint();
            await BenchPost.aggregate(pipeline);
            uncachedTimings.push(process.hrtime.bigint() - start);
        }

        // --- Cached ---
        await clearCache();
        // Warmup (cold cache fill)
        await (BenchPost.aggregate(pipeline) as any).cachePipeline();

        const cachedTimings: bigint[] = [];
        for (let i = 0; i < iterations; i++) {
            const start = process.hrtime.bigint();
            await (BenchPost.aggregate(pipeline) as any).cachePipeline();
            cachedTimings.push(process.hrtime.bigint() - start);
        }

        const uncachedStats = computeStats(uncachedTimings);
        const cachedStats = computeStats(cachedTimings);
        printBenchmarkPair('aggregate', uncachedStats, cachedStats);

        expect(cachedStats.avg_ms).toBeLessThan(uncachedStats.avg_ms);
    }, 60000);

    // ─── Benchmark 4: Population — uncached vs cached ──────────────────────

    it('population — uncached vs cached', async () => {
        const iterations = 30;

        // --- Uncached ---
        await clearCache();
        // Warmup
        for (let i = 0; i < WARMUP_ITERATIONS; i++) {
            await BenchPost.find().limit(10).populate('author');
        }

        const uncachedTimings: bigint[] = [];
        for (let i = 0; i < iterations; i++) {
            const start = process.hrtime.bigint();
            await BenchPost.find().limit(10).populate('author');
            uncachedTimings.push(process.hrtime.bigint() - start);
        }

        // --- Cached ---
        await clearCache();
        // Warmup (cold cache fill)
        await (BenchPost.find().limit(10) as any).cachePopulate('author').cacheQuery();

        const cachedTimings: bigint[] = [];
        for (let i = 0; i < iterations; i++) {
            const start = process.hrtime.bigint();
            await (BenchPost.find().limit(10) as any).cachePopulate('author').cacheQuery();
            cachedTimings.push(process.hrtime.bigint() - start);
        }

        const uncachedStats = computeStats(uncachedTimings);
        const cachedStats = computeStats(cachedTimings);
        printBenchmarkPair('populate', uncachedStats, cachedStats);

        expect(cachedStats.avg_ms).toBeLessThan(uncachedStats.avg_ms);
    }, 60000);

    // ─── Benchmark 5: Multi-path population (N+1 fix target) ─────────────

    it('multi-path population (4 paths) — uncached vs cached', async () => {
        const iterations = 30;

        // --- Uncached ---
        await clearCache();
        for (let i = 0; i < WARMUP_ITERATIONS; i++) {
            await BenchPost.find().limit(10).populate('author reviewer editor contributors');
        }

        const uncachedTimings: bigint[] = [];
        for (let i = 0; i < iterations; i++) {
            const start = process.hrtime.bigint();
            await BenchPost.find().limit(10).populate('author reviewer editor contributors');
            uncachedTimings.push(process.hrtime.bigint() - start);
        }

        // --- Cached ---
        await clearCache();
        await (BenchPost.find().limit(10) as any).cachePopulate('author reviewer editor contributors').cacheQuery();

        const cachedTimings: bigint[] = [];
        for (let i = 0; i < iterations; i++) {
            const start = process.hrtime.bigint();
            await (BenchPost.find().limit(10) as any).cachePopulate('author reviewer editor contributors').cacheQuery();
            cachedTimings.push(process.hrtime.bigint() - start);
        }

        const uncachedStats = computeStats(uncachedTimings);
        const cachedStats = computeStats(cachedTimings);
        printBenchmarkPair('populate (4 paths)', uncachedStats, cachedStats);

        expect(cachedStats.avg_ms).toBeLessThan(uncachedStats.avg_ms);
    }, 60000);

    // ─── Benchmark 6: Large result set population (batch relationship target) ──

    it('large result set population (50 docs) — uncached vs cached', async () => {
        const iterations = 20;

        // --- Uncached ---
        await clearCache();
        for (let i = 0; i < WARMUP_ITERATIONS; i++) {
            await BenchPost.find().limit(50).populate('author');
        }

        const uncachedTimings: bigint[] = [];
        for (let i = 0; i < iterations; i++) {
            const start = process.hrtime.bigint();
            await BenchPost.find().limit(50).populate('author');
            uncachedTimings.push(process.hrtime.bigint() - start);
        }

        // --- Cached ---
        await clearCache();
        await (BenchPost.find().limit(50) as any).cachePopulate('author').cacheQuery();

        const cachedTimings: bigint[] = [];
        for (let i = 0; i < iterations; i++) {
            const start = process.hrtime.bigint();
            await (BenchPost.find().limit(50) as any).cachePopulate('author').cacheQuery();
            cachedTimings.push(process.hrtime.bigint() - start);
        }

        const uncachedStats = computeStats(uncachedTimings);
        const cachedStats = computeStats(cachedTimings);
        printBenchmarkPair('populate (50 docs)', uncachedStats, cachedStats);

        expect(cachedStats.avg_ms).toBeLessThan(uncachedStats.avg_ms);
    }, 60000);

    // ─── Benchmark 7: Bulk updateMany invalidation (storm fix target) ──────

    it('bulk updateMany cache invalidation', async () => {
        const iterations = 10;
        const BULK_SIZE = 20;

        // Warmup
        for (let i = 0; i < 3; i++) {
            const users = [];
            for (let j = 0; j < BULK_SIZE; j++) {
                users.push({ name: `BulkWarmup_${i}_${j}`, email: `bw${i}_${j}@bench.test`, age: 25 });
            }
            const inserted = await BenchUser.insertMany(users);
            for (const u of inserted) {
                await (BenchUser.findOne({ name: u.name }) as any).cacheQuery();
            }
            await BenchUser.updateMany({ _id: { $in: inserted.map(u => u._id) } }, { age: 99 });
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        const timings: bigint[] = [];
        for (let i = 0; i < iterations; i++) {
            // Create a batch of users
            const users = [];
            for (let j = 0; j < BULK_SIZE; j++) {
                users.push({ name: `BulkTest_${i}_${j}`, email: `bt${i}_${j}@bench.test`, age: 30 });
            }
            const inserted = await BenchUser.insertMany(users);

            // Cache queries for each
            for (const u of inserted) {
                await (BenchUser.findOne({ name: u.name }) as any).cacheQuery();
            }

            const start = process.hrtime.bigint();

            // Bulk update triggers cache invalidation for all records
            await BenchUser.updateMany({ _id: { $in: inserted.map(u => u._id) } }, { age: 99 });

            // Wait for invalidation
            await new Promise(resolve => setTimeout(resolve, 50));

            timings.push(process.hrtime.bigint() - start);
        }

        const stats = computeStats(timings);
        printSingleBenchmark(`bulk updateMany (${BULK_SIZE} records)`, stats);

        expect(stats.avg_ms).toBeGreaterThan(0);
    }, 60000);

    // ─── Benchmark 8: Bulk updateMany with shared parents (dedup target) ──

    it('bulk updateMany with shared parents (dedup target)', async () => {
        const iterations = 10;
        const POSTS_PER_BATCH = 20;
        const SHARED_AUTHORS = 3; // 20 posts sharing only 3 authors → heavy dedup

        // Warmup
        for (let i = 0; i < 2; i++) {
            const authors = [];
            for (let a = 0; a < SHARED_AUTHORS; a++) {
                authors.push(await BenchUser.create({ name: `DedupWarmAuthor_${i}_${a}`, email: `dwa${i}_${a}@bench.test`, age: 30 }));
            }
            const posts = [];
            for (let p = 0; p < POSTS_PER_BATCH; p++) {
                posts.push({
                    title: `DedupWarmPost_${i}_${p}`,
                    content: 'warmup',
                    author: authors[p % SHARED_AUTHORS]._id,
                    reviewer: authors[(p + 1) % SHARED_AUTHORS]._id,
                    tags: ['warmup'],
                });
            }
            const insertedPosts = await BenchPost.insertMany(posts);
            // Cache populate queries so parent relationships are tracked
            for (const post of insertedPosts) {
                await (BenchPost.findOne({ _id: post._id }) as any).cachePopulate('author reviewer').cacheQuery();
            }
            await BenchPost.updateMany({ _id: { $in: insertedPosts.map(p => p._id) } }, { content: 'warmed up' });
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        const timings: bigint[] = [];
        for (let i = 0; i < iterations; i++) {
            // Create shared authors
            const authors = [];
            for (let a = 0; a < SHARED_AUTHORS; a++) {
                authors.push(await BenchUser.create({ name: `DedupAuthor_${i}_${a}`, email: `da${i}_${a}@bench.test`, age: 30 }));
            }

            // Create posts that share the same few authors
            const posts = [];
            for (let p = 0; p < POSTS_PER_BATCH; p++) {
                posts.push({
                    title: `DedupPost_${i}_${p}`,
                    content: `content ${p}`,
                    author: authors[p % SHARED_AUTHORS]._id,
                    reviewer: authors[(p + 1) % SHARED_AUTHORS]._id,
                    tags: ['dedup-test'],
                });
            }
            const insertedPosts = await BenchPost.insertMany(posts);

            // Cache populate queries to establish parent-child relationships
            for (const post of insertedPosts) {
                await (BenchPost.findOne({ _id: post._id }) as any).cachePopulate('author reviewer').cacheQuery();
            }

            const start = process.hrtime.bigint();

            // Bulk update triggers clearParentCacheBulk with shared parents
            await BenchPost.updateMany({ _id: { $in: insertedPosts.map(p => p._id) } }, { content: 'updated' });

            await new Promise(resolve => setTimeout(resolve, 50));

            timings.push(process.hrtime.bigint() - start);
        }

        const stats = computeStats(timings);
        printSingleBenchmark(`bulk updateMany shared parents (${POSTS_PER_BATCH} posts, ${SHARED_AUTHORS} authors)`, stats);

        expect(stats.avg_ms).toBeGreaterThan(0);
    }, 60000);

    // ─── Benchmark 9: Cache invalidation overhead ──────────────────────────

    it('cache invalidation overhead', async () => {
        const iterations = 30;

        // Warmup
        for (let i = 0; i < WARMUP_ITERATIONS; i++) {
            const tmpUser = await BenchUser.create({ name: `Warmup_${i}`, email: `warmup${i}@bench.test`, age: 25 });
            await (BenchUser.findOne({ name: tmpUser.name }) as any).cacheQuery();
            await BenchUser.updateOne({ _id: tmpUser._id }, { age: 99 });
            // Small delay to allow async cache clearing
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        const timings: bigint[] = [];
        for (let i = 0; i < iterations; i++) {
            const start = process.hrtime.bigint();

            // Create a new doc
            const user = await BenchUser.create({ name: `InvalidationTest_${i}`, email: `inv${i}@bench.test`, age: 30 });

            // Cache a query that returns this doc
            await (BenchUser.findOne({ name: user.name }) as any).cacheQuery();

            // Verify it is cached
            const isCachedBefore = await (BenchUser.findOne({ name: user.name }) as any).isCached();
            expect(isCachedBefore).toBe(true);

            // Update the doc (triggers auto-invalidation via SpeedGooseCacheAutoCleaner)
            await BenchUser.updateOne({ _id: user._id }, { age: 99 });

            // Small delay to allow async cache invalidation to propagate
            await new Promise(resolve => setTimeout(resolve, 50));

            // Verify the cache was cleared
            const isCachedAfter = await (BenchUser.findOne({ name: user.name }) as any).isCached();
            expect(isCachedAfter).toBe(false);

            timings.push(process.hrtime.bigint() - start);
        }

        const stats = computeStats(timings);
        printSingleBenchmark('cache invalidation cycle', stats);

        // Just verify it completed — the important thing is the invalidation works
        expect(stats.avg_ms).toBeGreaterThan(0);
    }, 60000);
});
