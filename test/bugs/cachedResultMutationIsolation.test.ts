import mongoose, { Document, Schema } from 'mongoose';
import Container from 'typedi';
import { applySpeedGooseCacheLayer } from '../../src/wrapper';
import { SpeedGooseCacheAutoCleaner } from '../../src/plugin/SpeedGooseCacheAutoCleaner';
import { SharedCacheStrategies, SpeedGooseConfig } from '../../src/types/types';
import { getRedisInstance } from '../../src/utils/redisUtils';
import { clearInflightRequests } from '../../src/utils/singleflightUtils';
import * as cacheClientUtils from '../../src/utils/cacheClientUtils';
import { UserModel, setupTestDB } from '../testUtils';

/**
 * BUG: a cached read returned the same object that was stored in the cache (IN_MEMORY strategy), or in the
 * local hydration cache (REDIS strategy, non-lean queries). If you changed the result without calling save(),
 * every later cached read saw that change, and saving one of those later results wrote someone else's change.
 *
 * Expected: every cached read returns its own objects, just like a database read.
 */

interface IIsolationMember {
    user?: any;
    role?: string;
}

interface IIsolation extends Document {
    title: string;
    meta?: any;
    when?: Date;
    tags: string[];
    prefs?: Map<string, number>;
    members: IIsolationMember[];
    owner?: any;
    ownerDoc?: any;
    score?: number;
    secret?: string;
}

const IsolationSchema = new Schema({
    title: String,
    meta: Schema.Types.Mixed,
    when: Date,
    tags: [String],
    prefs: { type: Map, of: Number },
    members: [new Schema({ user: { type: Schema.Types.ObjectId, ref: 'User' }, role: String })],
    owner: { type: Schema.Types.ObjectId, ref: 'User' },
    score: { type: Number, default: 0 },
    secret: { type: String, required: true, select: false },
});
IsolationSchema.virtual('ownerDoc', { ref: 'User', localField: 'owner', foreignField: '_id', justOne: true });
IsolationSchema.plugin(SpeedGooseCacheAutoCleaner);
const IsolationModel = (mongoose.models.MutationIsolation as mongoose.Model<IIsolation>) || mongoose.model<IIsolation>('MutationIsolation', IsolationSchema);

const DynamicRefSchema = new Schema({
    kind: String,
    target: { type: Schema.Types.ObjectId, refPath: 'kind' },
    viaFunction: { type: Schema.Types.ObjectId, ref: () => 'User' },
});
DynamicRefSchema.plugin(SpeedGooseCacheAutoCleaner);
const DynamicRefModel = (mongoose.models.MutationIsolationDynamicRef as mongoose.Model<any>) || mongoose.model('MutationIsolationDynamicRef', DynamicRefSchema);

const SelectedOwnerSchema = new Schema({ name: String, email: { type: String, default: 'default@example.com' } });
const SelectedOwnerModel = (mongoose.models.MutationIsolationOwner as mongoose.Model<any>) || mongoose.model('MutationIsolationOwner', SelectedOwnerSchema);
const OwnedThingModel = (mongoose.models.MutationIsolationOwnedThing as mongoose.Model<any>) || mongoose.model('MutationIsolationOwnedThing', new Schema({ title: String, owner: { type: Schema.Types.ObjectId, ref: 'MutationIsolationOwner' } }));

const TeamModel = (mongoose.models.MutationIsolationTeam as mongoose.Model<any>) || mongoose.model('MutationIsolationTeam', new Schema({ name: String, motto: { type: String, default: 'default motto' } }));
const MemberOwnerModel =
    (mongoose.models.MutationIsolationMemberOwner as mongoose.Model<any>) ||
    mongoose.model('MutationIsolationMemberOwner', new Schema({ name: String, password: { type: String, required: true, select: false }, team: { type: Schema.Types.ObjectId, ref: 'MutationIsolationTeam' } }));
const ProjectModel =
    (mongoose.models.MutationIsolationProject as mongoose.Model<any>) ||
    mongoose.model(
        'MutationIsolationProject',
        new Schema({
            owner: { type: Schema.Types.ObjectId, ref: 'MutationIsolationMemberOwner' },
            members: [
                new Schema({
                    kind: String,
                    target: {
                        type: Schema.Types.ObjectId,
                        ref(this: { kind: string }) {
                            return this.kind;
                        },
                    },
                }),
            ],
        }),
    );

const AnimalSchema = new Schema({ name: String }, { discriminatorKey: 'kind' });
AnimalSchema.plugin(SpeedGooseCacheAutoCleaner);
const AnimalModel = (mongoose.models.MutationIsolationAnimal as mongoose.Model<any>) || mongoose.model('MutationIsolationAnimal', AnimalSchema);
const DogModel = (AnimalModel.discriminators?.MutationIsolationDog as mongoose.Model<any>) || AnimalModel.discriminator('MutationIsolationDog', new Schema({ bark: String }));

const STRATEGIES: [string, () => SpeedGooseConfig][] = [
    ['IN_MEMORY', () => ({ sharedCacheStrategy: SharedCacheStrategies.IN_MEMORY })],
    ['REDIS', () => ({ redisUri: 'redis://localhost:6379', sharedCacheStrategy: SharedCacheStrategies.REDIS })],
];

const ORIGINAL_USER = { name: 'OriginalName', email: 'original@example.com', age: 30, fieldA: 'a' };

const readRawUser = (id: unknown) => UserModel.collection.findOne({ _id: id as mongoose.Types.ObjectId });
const readRawIsolation = (id: unknown) => IsolationModel.collection.findOne({ _id: id as mongoose.Types.ObjectId });

const createIsolationDoc = async () => {
    const owner = await UserModel.create({ name: 'Owner', email: 'owner@example.com' });
    const doc = await IsolationModel.create({
        title: 'Title',
        meta: { nested: { b: 1 } },
        when: new Date('2020-01-01T00:00:00.000Z'),
        tags: ['a'],
        prefs: { x: 1 },
        members: [{ user: owner._id, role: 'member' }],
        owner: owner._id,
        score: 5,
        secret: 'TopSecret',
    });

    return { owner, doc };
};

const resetData = async (): Promise<void> => {
    await getRedisInstance()?.flushall();
    clearInflightRequests();
    await Promise.all([
        UserModel.deleteMany({}),
        IsolationModel.deleteMany({}),
        AnimalModel.deleteMany({}),
        DynamicRefModel.deleteMany({}),
        SelectedOwnerModel.deleteMany({}),
        OwnedThingModel.deleteMany({}),
        TeamModel.deleteMany({}),
        MemberOwnerModel.deleteMany({}),
        ProjectModel.deleteMany({}),
    ]);
};

describe('BUG: cached results are shared with (and mutated by) callers', () => {
    beforeAll(async () => {
        await setupTestDB();
    });

    afterAll(async () => {
        await mongoose.connection.close();
        await mongoose.disconnect();
    });

    describe.each(STRATEGIES)('%s strategy', (strategy, makeConfig) => {
        beforeEach(async () => {
            Container.reset();
            await applySpeedGooseCacheLayer(mongoose, makeConfig());
            await resetData();
        });

        it('returns the persisted value after a cached read was mutated without save() (the reported scenario)', async () => {
            const created = await UserModel.create(ORIGINAL_USER);

            const firstRead = await UserModel.findById(created._id).cacheQuery();
            firstRead.name = 'MutatedInMemory';

            expect(await UserModel.findById(created._id).isCached()).toBe(true);
            const secondRead = await UserModel.findById(created._id).cacheQuery();

            expect(secondRead).not.toBe(firstRead);
            expect(secondRead.name).toBe('OriginalName');
            expect(secondRead.isModified()).toBe(false);

            // Saving the second read must not persist the first caller's unsaved change.
            await secondRead.save();
            expect((await readRawUser(created._id))?.name).toBe('OriginalName');
        });

        it('isolates consecutive cache hits from each other', async () => {
            const created = await UserModel.create(ORIGINAL_USER);

            await UserModel.findById(created._id).cacheQuery();
            const secondRead = await UserModel.findById(created._id).cacheQuery();
            secondRead.name = 'MutatedInMemory';
            const thirdRead = await UserModel.findById(created._id).cacheQuery();

            expect(thirdRead).not.toBe(secondRead);
            expect(thirdRead.name).toBe('OriginalName');
        });

        it('isolates lean results', async () => {
            const created = await UserModel.create({ ...ORIGINAL_USER, parents: [] });

            const firstRead = await UserModel.findById(created._id).lean().cacheQuery();
            firstRead.name = 'MutatedInMemory';
            firstRead.parents.push('injected' as any);
            const secondRead = await UserModel.findById(created._id).lean().cacheQuery();

            expect(secondRead).not.toBe(firstRead);
            expect(secondRead.name).toBe('OriginalName');
            expect(secondRead.parents).toEqual([]);
        });

        it.each([
            ['documents', false],
            ['lean', true],
        ])('isolates find() results (%s)', async (_label, lean) => {
            await UserModel.create([
                { name: 'Alice', email: 'alice@example.com', age: 30 },
                { name: 'Bob', email: 'bob@example.com', age: 30 },
            ]);
            const read = (): Promise<any[]> => {
                const query = UserModel.find({ age: 30 }).sort({ name: 1 });
                return (lean ? query.lean() : query).cacheQuery() as Promise<any[]>;
            };

            const firstRead = await read();
            firstRead[0].name = 'MutatedInMemory';
            firstRead.reverse();
            firstRead.push({ name: 'Injected' });
            const secondRead = await read();

            expect(secondRead).not.toBe(firstRead);
            expect(secondRead.map(user => user.name)).toEqual(['Alice', 'Bob']);
        });

        it('does not leak a mutation into a different query returning the same document', async () => {
            const created = await UserModel.create(ORIGINAL_USER);

            const byId = await UserModel.findById(created._id).cacheQuery();
            byId.name = 'MutatedInMemory';
            const byEmailMiss = await UserModel.findOne({ email: ORIGINAL_USER.email }).cacheQuery();
            const byEmailHit = await UserModel.findOne({ email: ORIGINAL_USER.email }).cacheQuery();

            for (const read of [byEmailMiss, byEmailHit]) {
                expect(read).not.toBe(byId);
                expect(read.name).toBe('OriginalName');
            }
            expect(byEmailHit).not.toBe(byEmailMiss);
        });

        it('isolates cachePipeline rows', async () => {
            await UserModel.create(ORIGINAL_USER);
            const read = (): Promise<any[]> => UserModel.aggregate([{ $match: { age: 30 } }, { $project: { name: 1, age: 1 } }]).cachePipeline();

            const firstRead = await read();
            firstRead[0].name = 'MutatedInMemory';
            firstRead.push({ name: 'Injected' });
            const secondRead = await read();

            expect(secondRead).not.toBe(firstRead);
            expect(secondRead).toHaveLength(1);
            expect(secondRead[0].name).toBe('OriginalName');
        });

        it('isolates distinct() results', async () => {
            await UserModel.create([
                { name: 'Alice', email: 'alice@example.com' },
                { name: 'Bob', email: 'bob@example.com' },
            ]);

            const firstRead = (await UserModel.distinct('name').cacheQuery()) as string[];
            firstRead.push('Injected');
            const secondRead = (await UserModel.distinct('name').cacheQuery()) as string[];

            expect(secondRead).not.toBe(firstRead);
            expect([...secondRead].sort()).toEqual(['Alice', 'Bob']);
        });

        it.each([
            ['exec()', (query: any) => query.exec()],
            ['cacheQuery()', (query: any) => query.cacheQuery()],
        ])('isolates lean cachePopulate children read through %s', async (_label, run) => {
            const parent = await UserModel.create({ name: 'ParentName', email: 'parent@example.com' });
            const childA = await UserModel.create({ name: 'ChildA', email: 'a@example.com', parent: parent._id });
            const childB = await UserModel.create({ name: 'ChildB', email: 'b@example.com', parent: parent._id });
            const read = (id: unknown) => run(UserModel.findById(id).lean().cachePopulate({ path: 'parent' }));

            const firstRead = await read(childA._id);
            firstRead.parent.name = 'MutatedInMemory';
            const secondRead = await read(childA._id);
            const siblingRead = await read(childB._id);

            expect(secondRead.parent).not.toBe(firstRead.parent);
            expect(secondRead.parent.name).toBe('ParentName');
            expect(siblingRead.parent.name).toBe('ParentName');
        });

        it('isolates populated child documents (cachePopulate + cacheQuery)', async () => {
            const parent = await UserModel.create({ name: 'ParentName', email: 'parent@example.com' });
            const child = await UserModel.create({ name: 'ChildName', email: 'child@example.com', parent: parent._id, parents: [parent._id] });
            const read = (): Promise<any> => UserModel.findById(child._id).cachePopulate('parent parents').cacheQuery();

            const firstRead = await read();
            firstRead.parent.name = 'MutatedInMemory';
            firstRead.parents[0].name = 'MutatedInMemory';
            const secondRead = await read();

            expect(secondRead.parent).not.toBe(firstRead.parent);
            expect(secondRead.parent.name).toBe('ParentName');
            expect(secondRead.parents[0].name).toBe('ParentName');
            expect(secondRead.parent.isModified()).toBe(false);
            expect(secondRead.isModified()).toBe(false);
            expect(String(secondRead.populated('parent'))).toBe(String(parent._id));
        });

        it('isolates nested values: Mixed, Date, arrays, Maps and sub-documents', async () => {
            const { doc } = await createIsolationDoc();
            const read = () => IsolationModel.findById(doc._id).cacheQuery();

            const firstRead = await read();
            firstRead.meta.nested.b = 2;
            firstRead.when.setUTCFullYear(1999);
            firstRead.tags.push('b');
            firstRead.prefs.set('x', 2);
            firstRead.members[0].role = 'admin';
            firstRead.members.push({ role: 'intruder' });
            const secondRead = await read();

            expect(secondRead.meta).toEqual({ nested: { b: 1 } });
            expect(secondRead.when.toISOString()).toBe('2020-01-01T00:00:00.000Z');
            expect([...secondRead.tags]).toEqual(['a']);
            expect(secondRead.prefs.get('x')).toBe(1);
            expect(secondRead.members).toHaveLength(1);
            expect(secondRead.members[0].role).toBe('member');
            expect(secondRead.isModified()).toBe(false);
        });

        it('isolates nested values of lean results', async () => {
            const { doc } = await createIsolationDoc();
            const read = (): Promise<any> => IsolationModel.findById(doc._id).lean().cacheQuery();

            const firstRead = await read();
            firstRead.meta.nested.b = 2;
            firstRead.tags.push('b');
            firstRead.members[0].role = 'admin';
            // With Redis, lean results have Dates as strings (JSON), so there is no Date to change.
            if (firstRead.when instanceof Date) firstRead.when.setUTCFullYear(1999);
            const secondRead = await read();

            expect(secondRead.meta).toEqual({ nested: { b: 1 } });
            expect(secondRead.tags).toEqual(['a']);
            expect(secondRead.members[0].role).toBe('member');
            expect(new Date(secondRead.when).toISOString()).toBe('2020-01-01T00:00:00.000Z');
        });

        it('gives concurrent cold-cache callers their own documents and writes the cache once', async () => {
            const created = await UserModel.create(ORIGINAL_USER);
            const setKeySpy = jest.spyOn(cacheClientUtils, 'setKeyInResultsCaches');

            const reads = await Promise.all([1, 2, 3].map(() => UserModel.findById(created._id).cacheQuery()));

            expect(setKeySpy).toHaveBeenCalledTimes(1);
            setKeySpy.mockRestore();
            expect(new Set(reads).size).toBe(3);
            reads[0].name = 'MutatedInMemory';
            expect(reads[1].name).toBe('OriginalName');
            expect(reads[2].name).toBe('OriginalName');
            expect((await UserModel.findById(created._id).cacheQuery()).name).toBe('OriginalName');
        });

        it.each([
            ['lean', (id: unknown): Promise<any> => UserModel.findById(id).lean().cacheQuery()],
            [
                'pipeline',
                (id: unknown): Promise<any> =>
                    UserModel.aggregate([{ $match: { _id: id } }])
                        .cachePipeline()
                        .then(rows => rows[0]),
            ],
        ])('gives concurrent cold-cache callers their own %s results', async (_label, read) => {
            const created = await UserModel.create(ORIGINAL_USER);

            const reads = await Promise.all([1, 2, 3].map(() => read(created._id)));

            expect(new Set(reads).size).toBe(3);
            reads[0].name = 'MutatedInMemory';
            expect(reads[1].name).toBe('OriginalName');
            expect(reads[2].name).toBe('OriginalName');
            expect((await read(created._id)).name).toBe('OriginalName');
        });

        it.each([
            ['cachePopulate', (id: unknown): Promise<any> => IsolationModel.findById(id).cachePopulate({ path: 'members.user' }).cacheQuery()],
            ['native populate', (id: unknown): Promise<any> => IsolationModel.findById(id).populate('members.user').cacheQuery()],
        ])('keeps members.user populated on a cache hit (%s)', async (_label, read) => {
            const { owner, doc } = await createIsolationDoc();

            await read(doc._id);
            const hit = await read(doc._id);

            expect(hit.members[0].user).toBeInstanceOf(mongoose.Document);
            expect(hit.members[0].user.name).toBe('Owner');
            await expect(hit.validate(['members'])).resolves.toBeUndefined();
            hit.depopulate('members.user');
            expect(hit.members[0].user).toBeInstanceOf(mongoose.Types.ObjectId);
            expect(String(hit.members[0].user)).toBe(String(owner._id));
        });

        it('keeps the projection of a select()-ed cached document, so save() writes only the real change', async () => {
            const { doc } = await createIsolationDoc();
            const read = () => IsolationModel.findById(doc._id).select('title').cacheQuery();

            await read();
            const hit = await read();

            expect(hit.score).toBeUndefined();
            expect(hit.isSelected('score')).toBe(false);
            hit.title = 'ChangedTitle';
            await hit.save();

            const raw = await readRawIsolation(doc._id);
            expect(raw).toMatchObject({ title: 'ChangedTitle', score: 5, secret: 'TopSecret', tags: ['a'] });
            expect(raw?.members).toHaveLength(1);
        });

        it('saves a cached document whose required field is excluded by select: false', async () => {
            const { doc } = await createIsolationDoc();
            const read = () => IsolationModel.findById(doc._id).cacheQuery();

            await read();
            const hit = await read();
            hit.title = 'ChangedTitle';
            await hit.save();

            expect(await readRawIsolation(doc._id)).toMatchObject({ title: 'ChangedTitle', secret: 'TopSecret', score: 5 });
        });

        it('keeps refs set with refPath or a ref function populated on a cache hit, and save() still works', async () => {
            const user = await UserModel.create({ name: 'Target', email: 'target@example.com' });
            const doc = await DynamicRefModel.create({ kind: 'User', target: user._id, viaFunction: user._id });
            const read = (): Promise<any> => DynamicRefModel.findById(doc._id).populate('target').populate('viaFunction').cacheQuery();

            await read();
            const hit = await read();

            expect(hit.target?.name).toBe('Target');
            expect(hit.viaFunction?.name).toBe('Target');
            hit.kind = 'User';
            await expect(hit.save()).resolves.toBeDefined();
        });

        it('keeps the populate select of a populated document, so saving it writes no defaults', async () => {
            const owner = await SelectedOwnerModel.collection.insertOne({ name: 'Owner' });
            const thing = await OwnedThingModel.create({ title: 'Thing', owner: owner.insertedId });
            const read = (): Promise<any> => OwnedThingModel.findById(thing._id).populate({ path: 'owner', select: 'name' }).cacheQuery();

            await read();
            const hit = await read();
            hit.owner.name = 'Renamed';
            await hit.owner.save();

            expect(await SelectedOwnerModel.collection.findOne({ _id: owner.insertedId })).toEqual({ _id: owner.insertedId, name: 'Renamed' });
        });

        it('keeps the select of a nested populate, so saving the nested document writes no defaults', async () => {
            const team = await TeamModel.collection.insertOne({ name: 'Team' });
            const owner = await MemberOwnerModel.create({ name: 'Owner', password: 'secret', team: team.insertedId });
            const project = await ProjectModel.create({ owner: owner._id });
            const read = (): Promise<any> =>
                ProjectModel.findById(project._id)
                    .populate({ path: 'owner', select: 'name team', populate: { path: 'team', select: 'name' } })
                    .cacheQuery();

            await read();
            const hit = await read();
            hit.owner.team.name = 'Renamed';
            await hit.owner.team.save();

            expect(await TeamModel.collection.findOne({ _id: team.insertedId })).toEqual({ _id: team.insertedId, name: 'Renamed' });
        });

        it("applies the populated model's select: false fields when the populate has no select", async () => {
            const owner = await MemberOwnerModel.create({ name: 'Owner', password: 'secret' });
            const project = await ProjectModel.create({ owner: owner._id });
            const read = (): Promise<any> => ProjectModel.findById(project._id).populate('owner').cacheQuery();

            await read();
            const hit = await read();
            expect(hit.owner.isSelected('password')).toBe(false);
            hit.owner.name = 'Renamed';
            await hit.owner.save();

            expect(await MemberOwnerModel.collection.findOne({ _id: owner._id })).toMatchObject({ name: 'Renamed', password: 'secret' });
        });

        it('calls a ref function with the subdocument that holds the ref', async () => {
            const user = await UserModel.create({ name: 'Target', email: 'target@example.com' });
            const project = await ProjectModel.create({ members: [{ kind: 'User', target: user._id }] });
            const read = (): Promise<any> => ProjectModel.findById(project._id).populate('members.target').cacheQuery();

            await read();
            const hit = await read();

            expect(hit.members[0].target?.name).toBe('Target');
        });

        it('returns an instance of the discriminator class on a cache hit', async () => {
            const dog = await DogModel.create({ name: 'Rex', bark: 'woof' });
            const read = () => AnimalModel.findById(dog._id).cacheQuery();

            await read();
            const hit = await read();

            expect(hit).toBeInstanceOf(DogModel);
            expect(hit.bark).toBe('woof');
        });

        // Known limitation: Redis stores plain JSON, which doesn't include populated virtuals.
        (strategy === 'REDIS' ? it.failing : it)('keeps a populated virtual on a cache hit', async () => {
            const { doc } = await createIsolationDoc();
            const read = (): Promise<any> => IsolationModel.findById(doc._id).populate('ownerDoc').cacheQuery();

            await read();
            const hit = await read();

            expect(hit.ownerDoc?.name).toBe('Owner');
        });
    });

    describe('shareCachedInstances: true (opt-out)', () => {
        beforeEach(async () => {
            Container.reset();
            await applySpeedGooseCacheLayer(mongoose, { sharedCacheStrategy: SharedCacheStrategies.IN_MEMORY, shareCachedInstances: true } as SpeedGooseConfig);
            await resetData();
        });

        it('hands every caller the same cached instance', async () => {
            const created = await UserModel.create(ORIGINAL_USER);

            const firstRead = await UserModel.findById(created._id).cacheQuery();
            const secondRead = await UserModel.findById(created._id).cacheQuery();

            expect(secondRead).toBe(firstRead);
        });
    });
});
