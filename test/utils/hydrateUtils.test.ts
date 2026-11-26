import mongoose, { Document, isObjectIdOrHexString, Schema, Types } from 'mongoose';
import { CachedDocument, CachedLeanDocument } from '../../src/types/types';
import { getReferenceModelNameFromSchema, hydrateResults } from '../../src/utils/hydrationUtils';
import { isResultWithId } from '../../src/utils/mongooseUtils';
import { prepareHydrateResultsTestCases } from '../assets/utils/hydrateResults';
import { MongooseTestDocument, TestModel } from '../types';

describe(`getReferenceModelNameFromSchema`, () => {
    test(`should handle empty type array`, () => {
        const testSchema = new Schema({ emptyTypeArray: [] });
        expect(getReferenceModelNameFromSchema(testSchema.path('emptyTypeArray'))).toEqual(undefined);
    });
});
describe(`hydrateResults`, () => {
    const checkDocumentConsistency = (result: MongooseTestDocument, sourceRecord: CachedLeanDocument<TestModel>): void => {
        //checking if the source record is just an id
        if (isObjectIdOrHexString(sourceRecord)) {
            expect(isObjectIdOrHexString(result)).toBeTruthy();
            // The field is an ObjectId, so a string id is converted to an ObjectId.
            expect(String(result)).toEqual(String(sourceRecord));
        } else {
            expect(result).toBeInstanceOf(Document);

            expect(String(result._id)).toEqual(String(sourceRecord._id));
            expect(result.fieldA).toEqual(sourceRecord.fieldA);
            expect(result.name).toEqual(sourceRecord.name);
        }
    };

    const runTest = (hydratedResult: MongooseTestDocument, sourceRecord: CachedLeanDocument<TestModel>) => {
        checkDocumentConsistency(hydratedResult, sourceRecord);
        //   testing nested documents
        if (sourceRecord.relationField) {
            checkDocumentConsistency(hydratedResult.relationField as MongooseTestDocument, sourceRecord.relationField as CachedLeanDocument<TestModel>);
            runTest(hydratedResult.relationField as MongooseTestDocument, sourceRecord.relationField as CachedLeanDocument<TestModel>);
        }

        const relationArray = sourceRecord?.relationArray as CachedLeanDocument<TestModel>[];

        if (relationArray?.length > 0) {
            relationArray.forEach((relation, index) => {
                checkDocumentConsistency((hydratedResult.relationArray as MongooseTestDocument[])[index] as MongooseTestDocument, relationArray[index] as CachedLeanDocument<TestModel>);
                runTest((hydratedResult.relationArray as MongooseTestDocument[])[index] as MongooseTestDocument, relationArray[index] as CachedLeanDocument<TestModel>);
            });
        }
    };

    test(`should properly recreate all documents from raw objects and turn them into deep populated documents`, async () => {
        for (const testCase of prepareHydrateResultsTestCases()) {
            // hydrateResults changes the records it gets, so compare against an untouched copy.
            const sourceRecord = JSON.parse(JSON.stringify(testCase.result));
            const hydratedResult = await hydrateResults<TestModel>(testCase.query, {}, testCase.result as CachedDocument<TestModel>);
            if (isResultWithId(sourceRecord)) {
                runTest(hydratedResult as MongooseTestDocument, sourceRecord as CachedLeanDocument<TestModel>);
            } else {
                (sourceRecord as CachedLeanDocument<TestModel>[]).forEach((result, index) => runTest((hydratedResult as MongooseTestDocument[])[index], result as CachedLeanDocument<TestModel>));
            }
        }
    });
});

describe(`hydrateResults rebuilding cached payloads`, () => {
    const HydrateUserModel = mongoose.models.HydrateUtilsUser || mongoose.model('HydrateUtilsUser', new Schema({ name: String }));
    const HydrateParentSchema = new Schema({
        title: String,
        score: { type: Number, default: 0 },
        secret: { type: String, required: true, select: false },
        tags: [String],
        profile: new Schema({ owner: { type: Schema.Types.ObjectId, ref: 'HydrateUtilsUser' } }),
        members: [new Schema({ user: { type: Schema.Types.ObjectId, ref: 'HydrateUtilsUser' }, children: [{ type: Schema.Types.ObjectId, ref: 'HydrateUtilsUser' }], role: String })],
    });
    const HydrateParentModel = mongoose.models.HydrateUtilsParent || mongoose.model('HydrateUtilsParent', HydrateParentSchema);
    const HydrateAnimalModel = mongoose.models.HydrateUtilsAnimal || mongoose.model('HydrateUtilsAnimal', new Schema({ name: String }, { discriminatorKey: 'kind' }));
    const HydrateDogModel = HydrateAnimalModel.discriminators?.HydrateUtilsDog || HydrateAnimalModel.discriminator('HydrateUtilsDog', new Schema({ bark: String }));

    // What a cached Redis payload looks like: JSON, ids as strings.
    const asPayload = <T>(value: T): T => JSON.parse(JSON.stringify(value));
    const ownerId = new Types.ObjectId();
    const owner = { _id: ownerId, name: 'Owner' };

    test(`builds populated children inside sub-documents as documents and registers them as populated`, async () => {
        const payload = asPayload({ _id: new Types.ObjectId(), title: 'T', members: [{ _id: new Types.ObjectId(), user: owner, children: [owner, owner], role: 'member' }], profile: { owner } });

        const hydrated = (await hydrateResults(HydrateParentModel.find(), {}, payload)) as any;

        expect(hydrated.members[0].user).toBeInstanceOf(Document);
        expect(hydrated.members[0].user.name).toBe('Owner');
        expect(hydrated.members[0].children[1]).toBeInstanceOf(Document);
        expect(hydrated.profile.owner).toBeInstanceOf(Document);
        expect(hydrated.isModified()).toBe(false);
        await expect(hydrated.validate(['members', 'profile'])).resolves.toBeUndefined();

        hydrated.depopulate('members.user');
        hydrated.depopulate('members.children');
        expect(hydrated.members[0].user).toBeInstanceOf(Types.ObjectId);
        expect(String(hydrated.members[0].user)).toBe(String(ownerId));
        expect(hydrated.members[0].children[0]).toBeInstanceOf(Types.ObjectId);
    });

    test(`resolves refs to models registered on another connection`, async () => {
        const connection = mongoose.createConnection();
        const RemoteUser = connection.model('HydrateUtilsRemoteUser', new Schema({ name: String }));
        const RemoteParent = connection.model('HydrateUtilsRemoteParent', new Schema({ owner: { type: Schema.Types.ObjectId, ref: 'HydrateUtilsRemoteUser' } }));

        const hydrated = (await hydrateResults(RemoteParent.find(), {}, asPayload({ _id: new Types.ObjectId(), owner }))) as any;

        expect(hydrated.owner).toBeInstanceOf(RemoteUser);
        expect(String(hydrated.populated('owner'))).toBe(String(ownerId));
        await connection.close();
    });

    test(`returns records that already are documents as they are`, async () => {
        const document = HydrateParentModel.hydrate({ _id: new Types.ObjectId(), title: 'T' });

        expect(await hydrateResults(HydrateParentModel.find(), {}, document)).toBe(document);
        expect((await hydrateResults(HydrateParentModel.find(), {}, [document]))[0]).toBe(document);
    });

    test(`keeps the projection of the query, including schema-level select: false paths`, async () => {
        const selected = (await hydrateResults(HydrateParentModel.findOne().select('title'), {}, asPayload({ _id: new Types.ObjectId(), title: 'T' }))) as any;
        expect(selected._id).toBeDefined();
        expect(selected.isSelected('score')).toBe(false);
        expect(selected.score).toBeUndefined();
        selected.title = 'Changed';
        expect(selected.$getChanges()).toEqual({ $set: { title: 'Changed' } });

        const unselected = (await hydrateResults(HydrateParentModel.findOne(), {}, asPayload({ _id: new Types.ObjectId(), title: 'T', score: 5, tags: ['a'], members: [] }))) as any;
        expect(unselected.isSelected('secret')).toBe(false);
        unselected.title = 'Changed';
        await expect(unselected.validate()).resolves.toBeUndefined();
        expect(unselected.$getChanges()).toEqual({ $set: { title: 'Changed' } });
    });

    test(`builds an instance of the discriminator named by the discriminator key`, async () => {
        const hydrated = (await hydrateResults(HydrateAnimalModel.find(), {}, asPayload({ _id: new Types.ObjectId(), name: 'Rex', bark: 'woof', kind: 'HydrateUtilsDog' }))) as any;

        expect(hydrated).toBeInstanceOf(HydrateDogModel);
        expect(hydrated.bark).toBe('woof');
    });

    test(`builds children of an unknown model as mongoose does, without throwing`, async () => {
        HydrateUserModel.hydrate(owner);
        const UnknownRefParent = mongoose.models.HydrateUtilsUnknownRef || mongoose.model('HydrateUtilsUnknownRef', new Schema({ owner: { type: Schema.Types.ObjectId, ref: 'HydrateUtilsNotRegistered' } }));

        await expect(hydrateResults(UnknownRefParent.find(), {}, asPayload({ _id: new Types.ObjectId(), owner: ownerId }))).resolves.toBeDefined();
    });
});
