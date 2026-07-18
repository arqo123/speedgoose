import mongoose, { Document } from 'mongoose';
import { applySpeedGooseCacheLayer } from '../../src/wrapper';
import { SpeedGooseCacheAutoCleaner } from '../../src/plugin/SpeedGooseCacheAutoCleaner';
import { setupTestDB, clearTestCache } from '../testUtils';

/**
 * Regression tests for dangling-ref alignment in cachePopulate.
 * When a populate path traverses an array of sub-documents (`members.child`) and one
 * ref is unresolvable, the stitched array must keep its positions with a null
 * placeholder — exactly like native populate. Without the fix the unresolved entry was
 * filtered out, shifting later docs onto the wrong sub-documents and leaving a trailing
 * raw ObjectId. Direct ref arrays (`kids`) instead drop unresolved entries, again
 * matching native populate.
 */

interface IAlignmentChild extends Document {
    name: string;
    ping(): string;
}

interface IAlignmentMember {
    child: IAlignmentChild | mongoose.Types.ObjectId | null;
    role?: string;
}

interface IAlignmentParent extends Document {
    title: string;
    members: IAlignmentMember[];
    kids: (IAlignmentChild | mongoose.Types.ObjectId)[];
    favorite?: IAlignmentChild | mongoose.Types.ObjectId | null;
}

const AlignmentChildSchema = new mongoose.Schema({
    name: String,
});
AlignmentChildSchema.methods.ping = function () {
    return 'pong';
};
AlignmentChildSchema.plugin(SpeedGooseCacheAutoCleaner);

const AlignmentMemberSchema = new mongoose.Schema({
    child: { type: mongoose.Schema.Types.ObjectId, ref: 'AlignmentChild' },
    role: String,
});

const AlignmentParentSchema = new mongoose.Schema({
    title: String,
    members: [AlignmentMemberSchema],
    kids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AlignmentChild' }],
    favorite: { type: mongoose.Schema.Types.ObjectId, ref: 'AlignmentChild' },
});
AlignmentParentSchema.plugin(SpeedGooseCacheAutoCleaner);

const AlignmentChildModel = (mongoose.models.AlignmentChild as mongoose.Model<IAlignmentChild>) || mongoose.model<IAlignmentChild>('AlignmentChild', AlignmentChildSchema);
const AlignmentParentModel = (mongoose.models.AlignmentParent as mongoose.Model<IAlignmentParent>) || mongoose.model<IAlignmentParent>('AlignmentParent', AlignmentParentSchema);

describe('bug: cachePopulate dangling-ref alignment', () => {
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
        await AlignmentChildModel.deleteMany({});
        await AlignmentParentModel.deleteMany({});
    });

    const createParentWithChildren = async () => {
        const [childA, childB, childC] = await AlignmentChildModel.create([{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
        const parent = await AlignmentParentModel.create({
            title: 'P',
            members: [
                { child: childA._id, role: 'first' },
                { child: childB._id, role: 'second' },
                { child: childC._id, role: 'third' },
            ],
            kids: [childA._id, childB._id, childC._id],
            favorite: childB._id,
        });
        return { childA, childB, childC, parent };
    };

    describe('path through a sub-document array (members.child)', () => {
        it('keeps positions aligned and sets null for a dangling ref, like native populate', async () => {
            const { childB, parent } = await createParentWithChildren();
            await AlignmentChildModel.deleteOne({ _id: childB._id });

            const result = (await AlignmentParentModel.findById(parent._id).cachePopulate({ path: 'members.child' }).exec()) as IAlignmentParent;

            expect(result.members).toHaveLength(3);
            expect((result.members[0].child as IAlignmentChild).name).toBe('A');
            expect(result.members[1].child).toBeNull();
            expect((result.members[2].child as IAlignmentChild).name).toBe('C');
            expect(typeof (result.members[0].child as IAlignmentChild).ping).toBe('function');
            expect((result.members[2].child as IAlignmentChild).ping()).toBe('pong');

            const native = (await AlignmentParentModel.findById(parent._id).populate('members.child').exec()) as IAlignmentParent;
            expect(result.members.map(member => (member.child ? (member.child as IAlignmentChild).name : null))).toEqual(native.members.map(member => (member.child ? (member.child as IAlignmentChild).name : null)));
        });

        it('populates every member when all refs resolve', async () => {
            const { parent } = await createParentWithChildren();

            const result = (await AlignmentParentModel.findById(parent._id).cachePopulate({ path: 'members.child' }).exec()) as IAlignmentParent;

            expect(result.members.map(member => (member.child as IAlignmentChild).name)).toEqual(['A', 'B', 'C']);
            for (const member of result.members) {
                expect(member.child).toBeInstanceOf(mongoose.Document);
            }
        });

        it('keeps the null placeholder for lean queries', async () => {
            const { childB, parent } = await createParentWithChildren();
            await AlignmentChildModel.deleteOne({ _id: childB._id });

            const result = await AlignmentParentModel.findById(parent._id).lean().cachePopulate({ path: 'members.child' }).exec();

            expect(result!.members).toHaveLength(3);
            expect((result!.members[0].child as IAlignmentChild).name).toBe('A');
            expect(result!.members[1].child).toBeNull();
            expect((result!.members[2].child as IAlignmentChild).name).toBe('C');
            expect(result!.members[0].child).not.toBeInstanceOf(mongoose.Document);
        });
    });

    describe('direct ref array (kids)', () => {
        it('drops a dangling ref without null placeholders, like native populate', async () => {
            const { childB, parent } = await createParentWithChildren();
            await AlignmentChildModel.deleteOne({ _id: childB._id });

            const result = (await AlignmentParentModel.findById(parent._id).cachePopulate({ path: 'kids' }).exec()) as IAlignmentParent;

            expect(result.kids).toHaveLength(2);
            expect(result.kids.map(kid => (kid as IAlignmentChild).name)).toEqual(['A', 'C']);

            const native = (await AlignmentParentModel.findById(parent._id).populate('kids').exec()) as IAlignmentParent;
            expect(result.kids.map(kid => (kid as IAlignmentChild).name)).toEqual(native.kids.map(kid => (kid as IAlignmentChild).name));
        });
    });

    describe('single ref (favorite)', () => {
        it('sets null for a dangling ref, like native populate', async () => {
            const { childB, parent } = await createParentWithChildren();
            await AlignmentChildModel.deleteOne({ _id: childB._id });

            const result = (await AlignmentParentModel.findById(parent._id).cachePopulate({ path: 'favorite' }).exec()) as IAlignmentParent;

            expect(result.favorite).toBeNull();
        });
    });
});
