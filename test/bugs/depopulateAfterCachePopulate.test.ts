import mongoose, { Document } from 'mongoose';
import { applySpeedGooseCacheLayer } from '../../src/wrapper';
import { SpeedGooseCacheAutoCleaner } from '../../src/plugin/SpeedGooseCacheAutoCleaner';
import { UserModel, setupTestDB, clearTestCache } from '../testUtils';

/**
 * Regression tests for the populate-bookkeeping fix (markPathPopulated).
 * Array-nested refs (`members.user`) fail without the fix — depopulate was a silent
 * no-op; single refs already work via Mongoose's setter, so those are just coverage.
 */

interface IClientMember {
    user: unknown;
    role?: string;
}

interface IClient extends Document {
    name: string;
    members: IClientMember[];
    owner?: unknown;
    populate(path: string): Promise<this>;
    populated(path: string): unknown;
    depopulate(path: string): this;
}

const MemberSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: String,
});

const ClientSchema = new mongoose.Schema({
    name: String,
    members: [MemberSchema],
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
});
ClientSchema.plugin(SpeedGooseCacheAutoCleaner);

const ClientModel = (mongoose.models.Client as mongoose.Model<IClient>) || mongoose.model<IClient>('Client', ClientSchema);

describe('bug: depopulate after cachePopulate', () => {
    beforeAll(async () => {
        await setupTestDB();
        await applySpeedGooseCacheLayer(mongoose, {});
    });

    afterAll(async () => {
        await mongoose.connection.close();
        await mongoose.disconnect();
    });

    beforeEach(async () => {
        await clearTestCache();
        await UserModel.deleteMany({});
        await ClientModel.deleteMany({});
    });

    describe('single ref', () => {
        it('registers the populate so doc.populated(path) returns the original id', async () => {
            const owner = await UserModel.create({ name: 'Owner', email: 'owner@example.com' });
            const created = await ClientModel.create({ name: 'Acme', owner: owner._id });

            const client = (await ClientModel.findById(created._id).cachePopulate({ path: 'owner' }).exec()) as IClient;

            expect(client.owner).toBeInstanceOf(mongoose.Document);
            expect(client.populated('owner')).toBeDefined();
            expect(String(client.populated('owner'))).toBe(String(owner._id));
        });

        it('depopulate restores the ObjectId on a cache-hydrated doc', async () => {
            const owner = await UserModel.create({ name: 'Owner', email: 'owner@example.com' });
            const created = await ClientModel.create({ name: 'Acme', owner: owner._id });

            const client = (await ClientModel.findById(created._id).cachePopulate({ path: 'owner' }).exec()) as IClient;

            client.depopulate('owner');
            expect(client.owner).toBeInstanceOf(mongoose.Types.ObjectId);
            expect(String(client.owner)).toBe(String(owner._id));

            await client.populate('owner');
            expect(client.owner).toBeInstanceOf(mongoose.Document);
            expect((client.owner as { name: string }).name).toBe('Owner');
        });
    });

    describe('array-nested ref (members.user)', () => {
        const createClientWithMembers = async () => {
            const userA = await UserModel.create({ name: 'Alice', email: 'alice@example.com' });
            const userB = await UserModel.create({ name: 'Bob', email: 'bob@example.com' });
            const created = await ClientModel.create({
                name: 'Acme',
                members: [
                    { user: userA._id, role: 'director' },
                    { user: userB._id, role: 'secretary' },
                ],
            });
            return { userA, userB, created };
        };

        it('registers the populate on every member sub-document', async () => {
            const { userA, userB, created } = await createClientWithMembers();

            const client = (await ClientModel.findById(created._id).cachePopulate({ path: 'members.user' }).exec()) as IClient;

            expect(client.members[0].user).toBeInstanceOf(mongoose.Document);
            expect(client.members[1].user).toBeInstanceOf(mongoose.Document);
            const member0 = client.members[0] as unknown as { populated(path: string): unknown };
            const member1 = client.members[1] as unknown as { populated(path: string): unknown };
            expect(String(member0.populated('user'))).toBe(String(userA._id));
            expect(String(member1.populated('user'))).toBe(String(userB._id));
        });

        it('depopulate restores each member id on a cache-hydrated doc (a silent no-op without the fix)', async () => {
            const { userA, userB, created } = await createClientWithMembers();

            const client = (await ClientModel.findById(created._id).cachePopulate({ path: 'members.user' }).exec()) as IClient;

            client.depopulate('members.user');

            // Without the fix depopulate no-ops, leaving full Documents.
            expect(client.members[0].user).toBeInstanceOf(mongoose.Types.ObjectId);
            expect(client.members[1].user).toBeInstanceOf(mongoose.Types.ObjectId);
            expect(String(client.members[0].user)).toBe(String(userA._id));
            expect(String(client.members[1].user)).toBe(String(userB._id));
        });

        it('survives a full depopulate -> populate round-trip with every member.user present', async () => {
            const { created } = await createClientWithMembers();

            const client = (await ClientModel.findById(created._id).cachePopulate({ path: 'members.user' }).exec()) as IClient;

            client.depopulate('members.user');
            await client.populate('members.user');

            for (const member of client.members) {
                expect(member.user).toBeTruthy();
                expect(member.user).toBeInstanceOf(mongoose.Document);
            }
            expect((client.members[0].user as { name: string }).name).toBe('Alice');
            expect((client.members[1].user as { name: string }).name).toBe('Bob');
        });

        it('matches a freshly-populated (non-cache) document', async () => {
            const { created } = await createClientWithMembers();

            const fromDb = (await ClientModel.findById(created._id).populate('members.user').exec()) as IClient;
            const fromCache = (await ClientModel.findById(created._id).cachePopulate({ path: 'members.user' }).exec()) as IClient;

            expect(Boolean(fromCache.populated('members.user'))).toBe(Boolean(fromDb.populated('members.user')));

            fromDb.depopulate('members.user');
            fromCache.depopulate('members.user');
            expect(String(fromCache.members[0].user)).toBe(String(fromDb.members[0].user));
            expect(String(fromCache.members[1].user)).toBe(String(fromDb.members[1].user));
        });
    });

    describe('lean queries', () => {
        it('does not attempt to register populate state on a lean (plain object) result', async () => {
            const owner = await UserModel.create({ name: 'Owner', email: 'owner@example.com' });
            const created = await ClientModel.create({ name: 'Acme', owner: owner._id });

            const client = await ClientModel.findById(created._id).lean().cachePopulate({ path: 'owner' }).exec();

            expect(client).toBeDefined();
            expect(client!.owner).not.toBeInstanceOf(mongoose.Document);
            expect((client!.owner as unknown as { name: string }).name).toBe('Owner');
        });
    });
});
