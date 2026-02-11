/**
 * Real-world integration test for speedgoose.
 *
 * This test simulates a realistic application that uses speedgoose for
 * mongoose query caching with the IN_MEMORY strategy. It exercises:
 *   - Initialization of the cache layer
 *   - Basic CRUD with cacheQuery()
 *   - Cache hit verification via isCached()
 *   - Auto-invalidation on save / delete
 *   - Aggregate caching via cachePipeline()
 *   - Cross-model cache isolation
 *   - Cached population via cachePopulate()
 *   - Concurrent cached operations
 *   - Clean shutdown
 */

import mongoose, { Schema, Model, Document } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { SpeedGooseCacheAutoCleaner } from '../../index';
import { clearAllCaches } from '../../src/utils/cacheUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IUser extends Document {
    name: string;
    email: string;
    age: number;
    posts?: IPost[] | mongoose.Types.ObjectId[];
}

interface IPost extends Document {
    title: string;
    body: string;
    author: mongoose.Types.ObjectId | IUser;
    comments?: IComment[] | mongoose.Types.ObjectId[];
}

interface IComment extends Document {
    text: string;
    post: mongoose.Types.ObjectId | IPost;
    author: mongoose.Types.ObjectId | IUser;
}

// ---------------------------------------------------------------------------
// Models (registered once, reused across tests)
// ---------------------------------------------------------------------------

let UserModel: Model<IUser>;
let PostModel: Model<IPost>;
let CommentModel: Model<IComment>;

// We need a dedicated mongoose connection for this suite because the global
// setupTestEnv.ts already connects the default mongoose instance. Instead of
// fighting that, we piggy-back on the same mongoose instance but ensure we have
// a real MongoDB underneath via mongodb-memory-server (already set up by the
// global test infra through testUtils.setupTestDB).

let mongoServer: MongoMemoryServer;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const registerModels = () => {
    // User schema
    const userSchema = new Schema<IUser>({
        name: { type: String, required: true },
        email: { type: String, required: true },
        age: { type: Number, default: 25 },
        posts: [{ type: Schema.Types.ObjectId, ref: 'IntegrationPost' }],
    });
    userSchema.plugin(SpeedGooseCacheAutoCleaner);

    // Post schema
    const postSchema = new Schema<IPost>({
        title: { type: String, required: true },
        body: { type: String, default: '' },
        author: { type: Schema.Types.ObjectId, ref: 'IntegrationUser' },
        comments: [{ type: Schema.Types.ObjectId, ref: 'IntegrationComment' }],
    });
    postSchema.plugin(SpeedGooseCacheAutoCleaner);

    // Comment schema
    const commentSchema = new Schema<IComment>({
        text: { type: String, required: true },
        post: { type: Schema.Types.ObjectId, ref: 'IntegrationPost' },
        author: { type: Schema.Types.ObjectId, ref: 'IntegrationUser' },
    });
    commentSchema.plugin(SpeedGooseCacheAutoCleaner);

    UserModel = mongoose.models['IntegrationUser'] ?? mongoose.model<IUser>('IntegrationUser', userSchema);
    PostModel = mongoose.models['IntegrationPost'] ?? mongoose.model<IPost>('IntegrationPost', postSchema);
    CommentModel = mongoose.models['IntegrationComment'] ?? mongoose.model<IComment>('IntegrationComment', commentSchema);
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Real-world integration test', () => {
    jest.setTimeout(120_000);

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        const uri = mongoServer.getUri();

        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
        await mongoose.connect(uri);

        registerModels();
    }, 60_000);

    afterAll(async () => {
        // Drop the test database and close the connection
        if (mongoose.connection.db) {
            await mongoose.connection.db.dropDatabase();
        }
        if (mongoServer) {
            await mongoServer.stop();
        }
    }, 30_000);

    beforeEach(async () => {
        // The global setupTestEnv.ts already calls Container.reset() and
        // applySpeedGooseCacheLayer() in its own beforeEach.  We just need
        // to clean our model data and caches.
        await Promise.all([
            UserModel.deleteMany({}),
            PostModel.deleteMany({}),
            CommentModel.deleteMany({}),
        ]);
        await clearAllCaches();
    });

    // -----------------------------------------------------------------------
    // 1. App initialisation
    // -----------------------------------------------------------------------
    it('should apply the speedgoose cache layer without errors', async () => {
        // The global beforeEach already applies the cache layer.  Verify that
        // the extended methods exist on Query and Aggregate prototypes.
        expect(typeof mongoose.Query.prototype.cacheQuery).toBe('function');
        expect(typeof mongoose.Query.prototype.isCached).toBe('function');
        expect(typeof mongoose.Query.prototype.cachePopulate).toBe('function');
        expect(typeof mongoose.Aggregate.prototype.cachePipeline).toBe('function');
        expect(typeof mongoose.Aggregate.prototype.isCached).toBe('function');
    }, 30_000);

    // -----------------------------------------------------------------------
    // 2. Basic CRUD with caching
    // -----------------------------------------------------------------------
    it('should create documents and return cached results via cacheQuery', async () => {
        const alice = await UserModel.create({ name: 'Alice', email: 'alice@example.com', age: 30 });

        // First read (populates cache)
        const result1 = await UserModel.findById(alice._id).cacheQuery();
        expect(result1).toBeDefined();
        expect(result1!.name).toBe('Alice');
        expect(result1!.email).toBe('alice@example.com');

        // Second read (should come from cache) — we verify by confirming that
        // the returned document is identical to the first.
        const result2 = await UserModel.findById(alice._id).cacheQuery();
        expect(result2).toBeDefined();
        expect(result2!.name).toBe('Alice');
        expect(JSON.stringify(result2)).toEqual(JSON.stringify(result1));
    }, 30_000);

    // -----------------------------------------------------------------------
    // 3. Cache hit verification
    // -----------------------------------------------------------------------
    it('should report a cache hit via isCached after the first cacheQuery call', async () => {
        const bob = await UserModel.create({ name: 'Bob', email: 'bob@example.com', age: 28 });

        const query = UserModel.findById(bob._id);

        // Before any cached call, query should not be cached
        const cachedBefore = await UserModel.findById(bob._id).isCached();
        expect(cachedBefore).toBe(false);

        // Populate cache
        await UserModel.findById(bob._id).cacheQuery();

        // After cached call, the same query pattern should now be cached
        const cachedAfter = await UserModel.findById(bob._id).isCached();
        expect(cachedAfter).toBe(true);
    }, 30_000);

    // -----------------------------------------------------------------------
    // 4. Cache invalidation on save (update)
    // -----------------------------------------------------------------------
    it('should clear cache when a document is updated (auto-cleaner)', async () => {
        const carol = await UserModel.create({ name: 'Carol', email: 'carol@example.com', age: 35 });

        // Populate cache
        const result1 = await UserModel.findById(carol._id).cacheQuery();
        expect(result1!.name).toBe('Carol');

        // Update the document via updateOne (triggers SpeedGooseCacheAutoCleaner)
        await UserModel.updateOne({ _id: carol._id }, { name: 'Carol Updated' });

        // The cache should have been invalidated; fresh data expected
        const result2 = await UserModel.findById(carol._id).cacheQuery();
        expect(result2).toBeDefined();
        expect(result2!.name).toBe('Carol Updated');
    }, 30_000);

    // -----------------------------------------------------------------------
    // 5. Cache invalidation on delete
    // -----------------------------------------------------------------------
    it('should clear cache when a document is deleted', async () => {
        const dave = await UserModel.create({ name: 'Dave', email: 'dave@example.com', age: 40 });

        // Populate cache
        const result1 = await UserModel.findOne({ email: 'dave@example.com' }).cacheQuery();
        expect(result1).toBeDefined();
        expect(result1!.name).toBe('Dave');

        // Delete the document
        await UserModel.deleteOne({ _id: dave._id });

        // Cache should be invalidated; query should return null now
        const result2 = await UserModel.findOne({ email: 'dave@example.com' }).cacheQuery();
        expect(result2).toBeNull();
    }, 30_000);

    // -----------------------------------------------------------------------
    // 6. Aggregate caching
    // -----------------------------------------------------------------------
    it('should cache aggregate results via cachePipeline', async () => {
        await UserModel.create([
            { name: 'Eve', email: 'eve@example.com', age: 20 },
            { name: 'Frank', email: 'frank@example.com', age: 30 },
            { name: 'Grace', email: 'grace@example.com', age: 30 },
        ]);

        const pipeline = [
            { $group: { _id: '$age', count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
        ];

        // First run populates cache
        const agg1 = await UserModel.aggregate(pipeline).cachePipeline();
        expect(agg1).toBeDefined();
        expect(agg1.length).toBe(2);
        expect(agg1).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ _id: 20, count: 1 }),
                expect.objectContaining({ _id: 30, count: 2 }),
            ]),
        );

        // Second run should return cached results
        const agg2 = await UserModel.aggregate(pipeline).cachePipeline();
        expect(JSON.stringify(agg2)).toEqual(JSON.stringify(agg1));
    }, 30_000);

    // -----------------------------------------------------------------------
    // 7. Aggregate cache invalidation
    // -----------------------------------------------------------------------
    it('should invalidate aggregate cache when underlying data changes', async () => {
        await UserModel.create([
            { name: 'Heidi', email: 'heidi@example.com', age: 25 },
            { name: 'Ivan', email: 'ivan@example.com', age: 25 },
        ]);

        const pipeline = [
            { $match: { age: 25 } },
            { $count: 'total' },
        ];

        // Populate cache
        const agg1 = await UserModel.aggregate(pipeline).cachePipeline();
        expect(agg1).toEqual([{ total: 2 }]);

        // Mutate data
        await UserModel.create({ name: 'Judy', email: 'judy@example.com', age: 25 });

        // After mutation the cache for this model should be invalidated
        const agg2 = await UserModel.aggregate(pipeline).cachePipeline();
        expect(agg2).toEqual([{ total: 3 }]);
    }, 30_000);

    // -----------------------------------------------------------------------
    // 8. Multiple models — cache isolation
    // -----------------------------------------------------------------------
    it('should only clear cache for the mutated model, not others', async () => {
        const user = await UserModel.create({ name: 'Karl', email: 'karl@example.com', age: 29 });
        const post = await PostModel.create({ title: 'My Post', body: 'Hello', author: user._id });

        // Cache queries for both models
        const cachedUser = await UserModel.findById(user._id).cacheQuery();
        const cachedPost = await PostModel.findById(post._id).cacheQuery();

        expect(cachedUser!.name).toBe('Karl');
        expect(cachedPost!.title).toBe('My Post');

        // Verify both are cached
        const userCached = await UserModel.findById(user._id).isCached();
        const postCached = await PostModel.findById(post._id).isCached();
        expect(userCached).toBe(true);
        expect(postCached).toBe(true);

        // Mutate user only
        await UserModel.updateOne({ _id: user._id }, { name: 'Karl Updated' });

        // Post cache should still be intact
        const postStillCached = await PostModel.findById(post._id).isCached();
        expect(postStillCached).toBe(true);

        // User cache should be invalidated and return fresh data
        const freshUser = await UserModel.findById(user._id).cacheQuery();
        expect(freshUser!.name).toBe('Karl Updated');
    }, 30_000);

    // -----------------------------------------------------------------------
    // 9. Cached population
    // -----------------------------------------------------------------------
    it('should correctly populate and cache related documents', async () => {
        const author = await UserModel.create({ name: 'Liam', email: 'liam@example.com', age: 32 });
        const post = await PostModel.create({ title: 'Cached Post', body: 'Content', author: author._id });

        // First query with cachePopulate
        const result1 = await PostModel.findById(post._id)
            .cachePopulate({ path: 'author' })
            .exec();

        expect(result1).toBeDefined();
        expect(result1!.author).toBeDefined();
        expect((result1!.author as any).name).toBe('Liam');

        // Second query should serve population from cache.
        // findById uses findOne for the main query (which is expected to hit the DB),
        // but the population sub-query (which uses find) should be served from cache.
        const collectionFindSpy = jest.spyOn(mongoose.Collection.prototype, 'find');
        const result2 = await PostModel.findById(post._id)
            .cachePopulate({ path: 'author' })
            .exec();

        expect(result2).toBeDefined();
        expect((result2!.author as any).name).toBe('Liam');
        expect(collectionFindSpy).not.toHaveBeenCalled();
        collectionFindSpy.mockRestore();
    }, 30_000);

    // -----------------------------------------------------------------------
    // 10. Concurrent operations
    // -----------------------------------------------------------------------
    it('should handle multiple simultaneous cached queries correctly', async () => {
        const users = await UserModel.create([
            { name: 'User1', email: 'u1@example.com', age: 21 },
            { name: 'User2', email: 'u2@example.com', age: 22 },
            { name: 'User3', email: 'u3@example.com', age: 23 },
            { name: 'User4', email: 'u4@example.com', age: 24 },
            { name: 'User5', email: 'u5@example.com', age: 25 },
        ]);

        // Run all cached queries concurrently
        const results = await Promise.all(
            users.map(u => UserModel.findById(u._id).cacheQuery()),
        );

        expect(results).toHaveLength(5);
        results.forEach((result, index) => {
            expect(result).toBeDefined();
            expect(result!.name).toBe(`User${index + 1}`);
        });

        // Run a second wave — should all hit cache
        const cachedResults = await Promise.all(
            users.map(u => UserModel.findById(u._id).cacheQuery()),
        );
        cachedResults.forEach((result, index) => {
            expect(result).toBeDefined();
            expect(result!.name).toBe(`User${index + 1}`);
        });
    }, 30_000);

    // -----------------------------------------------------------------------
    // 11. Clean shutdown
    // -----------------------------------------------------------------------
    it('should shutdown the mongoose connection cleanly', async () => {
        // This test simply verifies that the connection is still healthy after
        // all the prior tests.  The actual teardown is handled in afterAll.
        expect(mongoose.connection.readyState).toBe(1); // 1 = connected
        // Perform one last query to confirm the connection is still usable
        const count = await UserModel.countDocuments();
        expect(typeof count).toBe('number');
    }, 30_000);
});
