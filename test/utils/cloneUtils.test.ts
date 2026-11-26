import mongoose, { Document, Schema, Types } from 'mongoose';
import Container from 'typedi';
import { GlobalDiContainerRegistryNames } from '../../src/types/types';
import { detachCachedValue, isolateCachedValue } from '../../src/utils/cloneUtils';
import { getConfig } from '../../src/utils/commonUtils';

const { Binary, Decimal128, UUID } = mongoose.mongo.BSON;

const CloneUserModel = mongoose.models.CloneUtilsUser || mongoose.model('CloneUtilsUser', new Schema({ name: String }));

const CloneDocSchema = new Schema({
    title: String,
    score: { type: Number, default: 0 },
    secret: { type: String, required: true, select: false },
    tags: [String],
    meta: Schema.Types.Mixed,
    when: Date,
    prefs: { type: Map, of: Schema.Types.Mixed },
    owner: { type: Schema.Types.ObjectId, ref: 'CloneUtilsUser' },
    members: [new Schema({ user: { type: Schema.Types.ObjectId, ref: 'CloneUtilsUser' }, role: String })],
});
CloneDocSchema.virtual('ownerDoc', { ref: 'CloneUtilsUser', localField: 'owner', foreignField: '_id', justOne: true });
const CloneDocModel = mongoose.models.CloneUtilsDoc || mongoose.model('CloneUtilsDoc', CloneDocSchema);

const AnimalModel = mongoose.models.CloneUtilsAnimal || mongoose.model('CloneUtilsAnimal', new Schema({ name: String }, { discriminatorKey: 'kind' }));
const DogModel = AnimalModel.discriminators?.CloneUtilsDog || AnimalModel.discriminator('CloneUtilsDog', new Schema({ bark: String }));

/** A document as a query returns it when `secret` is excluded by its schema (select: false). */
const createSourceDocument = () => {
    const owner = CloneUserModel.hydrate({ _id: new Types.ObjectId(), name: 'Owner' });
    const source = CloneDocModel.hydrate(
        {
            _id: new Types.ObjectId(),
            title: 'Title',
            tags: ['a'],
            meta: { nested: { b: 1 } },
            when: new Date(0),
            prefs: { theme: { color: 'red' } },
            owner: owner._id,
            members: [{ _id: new Types.ObjectId(), user: owner._id, role: 'member' }],
        },
        { secret: 0 },
    );

    return { owner, source };
};

/** The same document, with `owner` and `members.user` populated like populate() and cachePopulate() do it. */
const createPopulatedSourceDocument = () => {
    const { owner, source } = createSourceDocument();
    source.init({ ...source.toObject(), owner, members: [{ ...source.members[0].toObject(), user: owner }] });
    source.populated('owner', owner._id);
    source.populated('members.user', [owner._id]);

    return { owner, source };
};

describe('detachCachedValue', () => {
    test('returns primitives as they are', () => {
        for (const value of [null, undefined, 1, 'text', true, BigInt(1)]) {
            expect(detachCachedValue(value)).toBe(value);
        }
    });

    test('copies plain objects and arrays deeply', () => {
        const value = { list: [{ a: 1 }], nested: { deep: { b: 2 } } };
        const copy = detachCachedValue(value);

        expect(copy).toEqual(value);
        expect(copy).not.toBe(value);
        expect(copy.list).not.toBe(value.list);
        expect(copy.list[0]).not.toBe(value.list[0]);
        expect(copy.nested.deep).not.toBe(value.nested.deep);
    });

    test('keeps objects without a prototype without one', () => {
        const value = Object.assign(Object.create(null), { a: { b: 1 } });
        const copy = detachCachedValue(value);

        expect(Object.getPrototypeOf(copy)).toBeNull();
        expect(copy.a).toEqual({ b: 1 });
        expect(copy.a).not.toBe(value.a);
    });

    test('copies Dates, RegExps, Maps and Sets', () => {
        const value = { when: new Date(0), pattern: /ab+c/gi, map: new Map([['k', { v: 1 }]]), set: new Set([{ v: 2 }]) };
        const copy = detachCachedValue(value);

        expect(copy.when).toEqual(value.when);
        expect(copy.when).not.toBe(value.when);
        expect(copy.pattern).toEqual(value.pattern);
        expect(copy.pattern).not.toBe(value.pattern);
        expect(copy.map.get('k')).toEqual({ v: 1 });
        expect(copy.map.get('k')).not.toBe(value.map.get('k'));
        expect([...copy.set][0]).toEqual({ v: 2 });
        expect([...copy.set][0]).not.toBe([...value.set][0]);
    });

    test('copies byte containers: Buffer, typed arrays, DataView, Binary and UUID', () => {
        const value = { buffer: Buffer.from('ab'), bytes: new Uint8Array([1, 2]), view: new DataView(new ArrayBuffer(2)), binary: new Binary(Buffer.from('ab')), uuid: new UUID() };
        const uuidBytes = Array.from(value.uuid.buffer);
        const copy = detachCachedValue(value);

        copy.buffer[0] = 0;
        copy.bytes[0] = 0;
        copy.view.setInt8(0, 7);
        copy.binary.buffer[0] = 0;
        copy.uuid.buffer[0] = uuidBytes[0] ^ 0xff;

        expect(value.buffer.toString()).toBe('ab');
        expect(Array.from(value.bytes)).toEqual([1, 2]);
        expect(value.view.getInt8(0)).toBe(0);
        expect(Buffer.from(value.binary.value()).toString()).toBe('ab');
        expect(Array.from(value.uuid.buffer)).toEqual(uuidBytes);
        expect(copy.binary).toBeInstanceOf(Binary);
        expect(copy.uuid).toBeInstanceOf(UUID);
    });

    test('shares immutable BSON values', () => {
        const value = { id: new Types.ObjectId(), amount: Decimal128.fromString('1.5') };
        const copy = detachCachedValue(value);

        expect(copy.id).toBe(value.id);
        expect(copy.amount).toBe(value.amount);
    });

    test('returns instances of unknown classes as they are', () => {
        class Custom {
            public value = 1;
        }
        const instance = new Custom();

        expect(detachCachedValue({ instance }).instance).toBe(instance);
    });

    test('keeps an object referenced twice shared within the copy, and copes with cycles', () => {
        const shared = { a: 1 };
        const value: Record<string, unknown> = { first: shared, second: shared };
        value.self = value;
        const copy = detachCachedValue(value);

        expect(copy.first).toBe(copy.second);
        expect(copy.first).not.toBe(shared);
        expect(copy.self).toBe(copy);
    });
});

describe('detachCachedValue for mongoose documents', () => {
    test('returns a new instance of the same class, built like a query result', () => {
        const { source } = createSourceDocument();
        const copy = detachCachedValue(source);

        expect(copy).toBeInstanceOf(CloneDocModel);
        expect(copy).not.toBe(source);
        expect(copy.isNew).toBe(false);
        expect(copy.toObject()).toEqual(source.toObject());
    });

    test('keeps the discriminator class', () => {
        const dog = DogModel.hydrate({ _id: new Types.ObjectId(), name: 'Rex', bark: 'woof', kind: 'CloneUtilsDog' });
        const copy = detachCachedValue(dog);

        expect(copy).toBeInstanceOf(DogModel);
        expect(copy.bark).toBe('woof');
    });

    test('keeps the projection: no defaults for unselected paths and save() writes only real changes', async () => {
        const source = CloneDocModel.hydrate({ _id: new Types.ObjectId(), title: 'Title' }, { title: 1 });
        const copy = detachCachedValue(source);

        expect(copy.isSelected('score')).toBe(false);
        expect(copy.score).toBeUndefined();
        expect(copy.isModified()).toBe(false);
        copy.title = 'Changed';
        expect(copy.$getChanges()).toEqual({ $set: { title: 'Changed' } });
        await expect(copy.validate()).resolves.toBeUndefined();
    });

    test('copies populated documents and keeps the populate bookkeeping, nested paths included', () => {
        const { owner, source } = createPopulatedSourceDocument();
        const copy = detachCachedValue(source);

        expect(copy.owner).toBeInstanceOf(Document);
        expect(copy.owner).not.toBe(owner);
        expect(copy.owner.name).toBe('Owner');
        expect(String(copy.populated('owner'))).toBe(String(owner._id));
        expect(copy.members[0].user).toBeInstanceOf(Document);
        expect(copy.members[0].user).not.toBe(owner);

        copy.depopulate('owner');
        copy.depopulate('members.user');
        expect(copy.owner).toBeInstanceOf(Types.ObjectId);
        expect(copy.members[0].user).toBeInstanceOf(Types.ObjectId);
        expect(String(copy.members[0].user)).toBe(String(owner._id));
    });

    test('keeps lean-populated children as plain objects', () => {
        const { owner, source } = createSourceDocument();
        // What populate({ path: 'owner', options: { lean: true } }) leaves behind.
        source.populated('owner', owner._id, { options: { lean: true } });
        source.init({ ...source.toObject(), owner: { _id: owner._id, name: 'Owner' } });
        const copy = detachCachedValue(source);

        expect(copy.owner).not.toBeInstanceOf(Document);
        expect(copy.owner).toEqual({ _id: owner._id, name: 'Owner' });
        expect(copy.owner).not.toBe(source.owner);
    });

    test('copies populated virtuals', () => {
        const { owner, source } = createSourceDocument();
        source.ownerDoc = owner;
        const copy = detachCachedValue(source);

        expect(copy.ownerDoc).toBeInstanceOf(Document);
        expect(copy.ownerDoc).not.toBe(owner);
        expect(copy.ownerDoc.name).toBe('Owner');
    });

    test('shares neither $locals nor the session of the source', () => {
        const { source } = createSourceDocument();
        source.$locals.requestId = 'first-request';
        source.$session({ id: 'first-request-session' } as never);
        const copy = detachCachedValue(source);

        expect(copy.$locals).toEqual({});
        expect(copy.$session()).toBeFalsy();
    });

    test('changing the copy changes neither the data nor the modified state of the source', () => {
        const { owner, source } = createPopulatedSourceDocument();
        const copy = detachCachedValue(source);

        copy.title = 'Changed';
        copy.tags.push('b');
        copy.meta.nested.b = 2;
        copy.when.setTime(1);
        copy.prefs.get('theme').color = 'blue';
        copy.members[0].role = 'admin';
        copy.members.push({ role: 'new' });
        copy.owner.name = 'ChangedOwner';
        copy.members[0].user.name = 'ChangedMember';

        expect(source.toObject({ depopulate: true })).toEqual(createSourceDocumentShape(source, owner));
        expect(owner.name).toBe('Owner');
        expect(source.isModified()).toBe(false);
    });
});

// The data from createSourceDocument(), to check the original is unchanged after the copy was modified.
const createSourceDocumentShape = (source: any, owner: any) => ({
    _id: source._id,
    title: 'Title',
    // not excluded by the projection, so mongoose fills in the default
    score: 0,
    tags: ['a'],
    meta: { nested: { b: 1 } },
    when: new Date(0),
    prefs: new Map([['theme', { color: 'red' }]]),
    owner: owner._id,
    members: [{ _id: source.members[0]._id, user: owner._id, role: 'member' }],
});

describe('isolateCachedValue', () => {
    test('returns a copy by default', () => {
        const value = { a: { b: 1 } };

        expect(isolateCachedValue(value)).not.toBe(value);
        expect(isolateCachedValue(value)).toEqual(value);
    });

    test('returns the value itself when shareCachedInstances is on', () => {
        Container.set(GlobalDiContainerRegistryNames.CONFIG_GLOBAL_ACCESS, { ...getConfig(), shareCachedInstances: true });
        const value = { a: { b: 1 } };

        expect(isolateCachedValue(value)).toBe(value);
    });
});
