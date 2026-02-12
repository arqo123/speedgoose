import mongoose, { Document } from 'mongoose';
import { applySpeedGooseCacheLayer } from '../../src/wrapper';
import { UserModel, setupTestDB, clearTestCache } from '../testUtils';

interface IUser extends Document {
    name: string;
    email: string;
    age?: number;
    parent?: IUser | mongoose.Types.ObjectId;
    parents?: (IUser | mongoose.Types.ObjectId)[];

    // TypeScript virtual methods for population
    populate(path: string): Promise<this>;
}

describe('cachePopulate', () => {

    beforeAll(async () => {
        await setupTestDB();
        applySpeedGooseCacheLayer(mongoose, {});
    });

    afterAll(async () => {
        await mongoose.connection.close();
        await mongoose.disconnect();
    });

    beforeEach(async () => {
        await clearTestCache();
        await UserModel.deleteMany({});
    });

    it('should populate documents using cache', async () => {
        // Create parent user
        const parent = await UserModel.create({ name: 'Parent', email: 'parent@example.com' });

        // Create child user referencing parent
        const child = await UserModel.create({
            name: 'Child',
            email: 'child@example.com',
            parent: parent._id
        });

        // Query child and populate parent
        const result = await UserModel.findOne({ _id: child._id })
            .cachePopulate({ path: 'parent' })
            .exec();

        expect(result).toBeDefined();
        expect(result!.parent).toBeInstanceOf(mongoose.Document);
        expect((result!.parent as unknown as IUser).name).toBe('Parent');
    });

    it('should handle multiple populate options', async () => {
        const parent1 = await UserModel.create({ name: 'Parent1', email: 'parent1@example.com' });
        const parent2 = await UserModel.create({ name: 'Parent2', email: 'parent2@example.com' });
        const child = await UserModel.create({
            name: 'Child',
            email: 'child@example.com',
            parents: [parent1._id, parent2._id]
        });

        const result = await UserModel.findOne({ _id: child._id })
            .cachePopulate([
                { path: 'parents' }
            ])
            .exec();

        expect(result).toBeDefined();
        expect(result!.parents).toHaveLength(2);
        expect((result!.parents[0] as unknown as IUser).name).toBe('Parent1');
        expect((result!.parents[1] as unknown as IUser).name).toBe('Parent2');
    });


    it('should return the same populated data on subsequent queries (cache hit)', async () => {
        const parent = await UserModel.create({ name: 'Parent', email: 'parent@test.com' });
        const user = await UserModel.create({
            name: 'CacheTest',
            email: 'cache@test.com',
            parent: parent._id
        });

        // Initial query with population
        const firstResult = await UserModel.findOne({ _id: user._id })
            .cachePopulate({ path: 'parent' })
            .exec();
        expect(firstResult).toBeDefined();
        expect(firstResult?.parent?.name).toBe('Parent');

        // Subsequent query with population (should hit cache)
        const secondResult = await UserModel.findOne({ _id: user._id })
            .cachePopulate({ path: 'parent' })
            .exec();

        expect(secondResult).toBeDefined();
        expect(secondResult?.name).toBe('CacheTest');
        expect(secondResult?.parent?.name).toBe('Parent');

        // Optionally, check that the returned objects are deeply equal
        expect(JSON.stringify(secondResult)).toEqual(JSON.stringify(firstResult));
    });

    it('should invalidate cache when document is updated and return fresh data', async () => {
        const parent = await UserModel.create({ name: 'Parent', email: 'parent@test.com' });
        const child = await UserModel.create({ name: 'Child', email: 'child@test.com', parent: parent._id });

        // Initial query with cachePopulate
        const firstResult = await UserModel.findOne({ _id: child._id })
            .cachePopulate({ path: 'parent' })
            .exec();
        expect(firstResult).toBeDefined();
        if (firstResult!.parent && typeof firstResult!.parent !== 'string') {
            expect((firstResult!.parent as IUser).name).toBe('Parent');
        }

        // Update parent document
        await UserModel.updateOne({ _id: parent._id }, { name: 'UpdatedParent' });

        // Subsequent query should bypass cache and get updated parent
        const spy = jest.spyOn(UserModel, 'findOne');
        const secondResult = await UserModel.findOne({ _id: child._id })
            .cachePopulate({ path: 'parent' })
            .exec();

        expect(secondResult).toBeDefined();
        if (secondResult!.parent && typeof secondResult!.parent !== 'string') {
            expect((secondResult!.parent as IUser).name).toBe('UpdatedParent');
        }
        expect(spy).toHaveBeenCalledTimes(1); // Verify DB hit
        spy.mockRestore();
    });

    it('should invalidate parent document cache on child update', async () => {
        // Create parent-child relationship
        const parent = await UserModel.create({ name: 'Parent', email: 'parent@test.com' });
        const child = await UserModel.create({
            name: 'Child',
            email: 'child@test.com',
            parent: parent._id
        });

        // Cache parent with populated child
        const firstParent = (await UserModel.findById(child._id)
            .cachePopulate({ path: 'parent' })
            .exec())
        expect(firstParent).toBeDefined();

        // Update child document
        await UserModel.updateOne({ _id: parent._id }, { name: 'New populated record name' });

        // Verify parent cache is invalidated and shows updated child
        const spy = jest.spyOn(UserModel, 'findById');
        const secondParent = await UserModel.findById(child._id)
            .cachePopulate({ path: 'parent' })

        expect(secondParent).toBeDefined();
        expect(spy).toHaveBeenCalledTimes(1); // Verify DB hit
        const updatedChild = await UserModel.findById(parent._id);
        expect(updatedChild!.name).toBe('New populated record name');
        expect((secondParent.parent as IUser).name).toBe('New populated record name');
        spy.mockRestore();
    });

    it(`should handle population with multiple paths`, async () => {
        // Create parent and relation user documents
        const parent = await UserModel.create({ name: 'Parent', email: 'parent@example.com' });
        const relation = await UserModel.create({ name: 'Relation', email: 'relation@example.com' });

        // Create child user referencing both parent and relationField
        const child = await UserModel.create({
            name: 'Child',
            email: 'child@example.com',
            parent: parent._id,
            relationField: relation._id
        });

        // Query child and populate both parent and relationField
        const result = await UserModel.findOne({ _id: child._id })
            .cachePopulate([
                { path: 'parent' },
                { path: 'relationField' }
            ])
            .exec();

        expect(result).toBeDefined();
        expect(result!.parent).toBeInstanceOf(mongoose.Document);
        expect(result!.relationField).toBeInstanceOf(mongoose.Document);
        expect((result!.parent as unknown as IUser).name).toBe('Parent');
        expect((result!.relationField as unknown as IUser).name).toBe('Relation');
    })

    it('should handle population with multiple paths when passed as a single string', async () => {
        // Create parent and relation user documents
        const parent = await UserModel.create({ name: 'Parent', email: 'parent@example.com' });
        const relation = await UserModel.create({ name: 'Relation', email: 'relation@example.com' });

        // Create child user referencing both parent and relationField
        const child = await UserModel.create({
            name: 'Child',
            email: 'child@example.com',
            parent: parent._id,
            relationField: relation._id,
        });

        // Query child and populate both parent and relationField
        const result = await UserModel.findOne({ _id: child._id })
            .cachePopulate('parent relationField')
            .exec();

        expect(result).toBeDefined();
        expect(result!.parent).toBeInstanceOf(mongoose.Document);
        expect(result!.relationField).toBeInstanceOf(mongoose.Document);
        expect((result!.parent as unknown as IUser).name).toBe('Parent');
        expect((result!.relationField as unknown as IUser).name).toBe('Relation');
    });

    it('should return the same populated data on subsequent queries with multiple paths (cache hit)', async () => {
        // Create parent and relation user documents
        const parent = await UserModel.create({ name: 'Parent', email: 'parent@example.com' });
        const relation = await UserModel.create({ name: 'Relation', email: 'relation@example.com' });

        // Create child user referencing both parent and relationField
        const child = await UserModel.create({
            name: 'Child',
            email: 'child@example.com',
            parent: parent._id,
            relationField: relation._id
        });

        // Spy on Collection.prototype.find to track actual DB hits
        const collectionFindSpy = jest.spyOn(mongoose.Collection.prototype, 'find');

        // First query: should hit DB
        const firstResult = await UserModel.findOne({ _id: child._id })
            .cachePopulate([
                { path: 'parent' },
                { path: 'relationField' }
            ])

        expect(firstResult).toBeDefined();
        expect(firstResult!.parent).toBeDefined();
        expect((firstResult!.parent as unknown as IUser).name).toBe('Parent');
        expect(firstResult!.relationField).toBeDefined();
        expect((firstResult!.relationField as unknown as IUser).name).toBe('Relation');
        expect(collectionFindSpy).toHaveBeenCalled();

        // Second query: should hit cache, not DB
        collectionFindSpy.mockClear();
        const secondResult = await UserModel.findOne({ _id: child._id })
            .cachePopulate([
                { path: 'parent' },
                { path: 'relationField' }
            ])

        expect(secondResult).toBeDefined();
        expect(secondResult!.parent).toBeDefined();
        expect((secondResult!.parent as unknown as IUser).name).toBe('Parent');
        expect(secondResult!.relationField).toBeDefined();
        expect((secondResult!.relationField as unknown as IUser).name).toBe('Relation');
        expect(collectionFindSpy).not.toHaveBeenCalled(); // Should not hit DB

        // Deep equality check
        expect(JSON.stringify(secondResult)).toEqual(JSON.stringify(firstResult));
        collectionFindSpy.mockRestore();
    })

    it(`should handle populate with select fields`, async () => {
        // Create parent user with extra field
        const parent = await UserModel.create({ name: 'Parent', email: 'parent@example.com', fieldA: 'extra' });
        // Create child referencing parent
        const child = await UserModel.create({
            name: 'Child',
            email: 'child@example.com',
            parent: parent._id
        });

        // Populate parent with select fields only
        const result = await UserModel.findOne({ _id: child._id })
            .cachePopulate({ path: 'parent', select: 'name email' });

        expect(result).toBeDefined();
        expect(result!.parent).toBeDefined();
        const populatedParent = result!.parent as unknown as IUser;
        expect(populatedParent.name).toBe('Parent');
        expect(populatedParent.email).toBe('parent@example.com');
        // Should not have fieldA
        expect((populatedParent as any).fieldA).toBeUndefined();

        // Second query: should hit cache, not DB
        const collectionFindSpy = jest.spyOn(mongoose.Collection.prototype, 'find');
        const cachedResult = await UserModel.findOne({ _id: child._id })
            .cachePopulate({ path: 'parent', select: 'name email' });
        expect(cachedResult).toBeDefined();
        expect(cachedResult!.parent).toBeDefined();
        const cachedParent = cachedResult!.parent as unknown as IUser;
        expect(cachedParent.name).toBe('Parent');
        expect(cachedParent.email).toBe('parent@example.com');
        expect((cachedParent as any).fieldA).toBeUndefined();
        expect(collectionFindSpy).not.toHaveBeenCalled();
        collectionFindSpy.mockRestore();
    })

    it(`should handle populate with lean call on cache query`, async () => {
        // Create parent user
        const parent = await UserModel.create({ name: 'Parent', email: 'parent@example.com' });
        // Create child referencing parent
        const child = await UserModel.create({
            name: 'Child',
            email: 'child@example.com',
            parent: parent._id
        });

        // Query with lean and cachePopulate
        const result = await UserModel.findOne({ _id: child._id })
            .lean()
            .cachePopulate({ path: 'parent' });

        expect(result).toBeDefined();
        expect(result && result.parent).toBeDefined();
        // Should be a plain object, not a Mongoose Document
        expect(result && result.parent && (result.parent as any)).not.toBeInstanceOf(mongoose.Document);
        const leanParent = result && result.parent ? (result.parent as unknown as { name: string; email: string }) : undefined;
        expect(leanParent && leanParent.name).toBe('Parent');
        expect(leanParent && leanParent.email).toBe('parent@example.com');

        // Second query: should hit cache, not DB
        const collectionFindSpy = jest.spyOn(mongoose.Collection.prototype, 'find');
        const cachedResult = await UserModel.findOne({ _id: child._id })
            .lean()
            .cachePopulate({ path: 'parent' });
        expect(cachedResult).toBeDefined();
        expect(cachedResult && cachedResult.parent).toBeDefined();
        expect(cachedResult && cachedResult.parent && (cachedResult.parent as any)).not.toBeInstanceOf(mongoose.Document);
        const leanCachedParent = cachedResult && cachedResult.parent ? (cachedResult.parent as unknown as { name: string; email: string }) : undefined;
        expect(leanCachedParent && leanCachedParent.name).toBe('Parent');
        expect(leanCachedParent && leanCachedParent.email).toBe('parent@example.com');
        expect(collectionFindSpy).not.toHaveBeenCalled();
        collectionFindSpy.mockRestore();
    })

    it(`should handle populate with select fields and dont call cache on different fields select variations`, async () => {
        // Create parent user with extra field
        const parent = await UserModel.create({ name: 'Parent', email: 'parent@example.com', fieldA: 'extra' });
        // Create child referencing parent
        const child = await UserModel.create({
            name: 'Child',
            email: 'child@example.com',
            parent: parent._id
        });

        // First query: populate with select 'name email'
        const resultSelect = await UserModel.findOne({ _id: child._id })
            .cachePopulate({ path: 'parent', select: 'name email' });
        expect(resultSelect).toBeDefined();
        expect(resultSelect!.parent).toBeDefined();
        const parentSelect = resultSelect!.parent as unknown as IUser;
        expect(parentSelect.name).toBe('Parent');
        expect(parentSelect.email).toBe('parent@example.com');
        expect((parentSelect as any).fieldA).toBeUndefined();

        // Second query: populate with select 'name email fieldA'
        const resultSelectExtra = await UserModel.findOne({ _id: child._id })
            .cachePopulate({ path: 'parent', select: 'name email fieldA' });
        expect(resultSelectExtra).toBeDefined();
        expect(resultSelectExtra!.parent).toBeDefined();
        const parentSelectExtra = resultSelectExtra!.parent as unknown as IUser;
        expect(parentSelectExtra.name).toBe('Parent');
        expect(parentSelectExtra.email).toBe('parent@example.com');
        expect((parentSelectExtra as any).fieldA).toBe('extra');

        // Third query: populate with no select (should get all fields)
        const resultNoSelect = await UserModel.findOne({ _id: child._id })
            .cachePopulate({ path: 'parent' });
        expect(resultNoSelect).toBeDefined();
        expect(resultNoSelect!.parent).toBeDefined();
        const parentNoSelect = resultNoSelect!.parent as unknown as IUser;
        expect(parentNoSelect.name).toBe('Parent');
        expect(parentNoSelect.email).toBe('parent@example.com');
        expect((parentNoSelect as any).fieldA).toBe('extra');

        // Now check that each query is independent in cache (no cross-contamination)
        expect((parentSelect as any).fieldA).toBeUndefined();
        expect((parentSelectExtra as any).fieldA).toBe('extra');
        expect((parentNoSelect as any).fieldA).toBe('extra');
    })



        // Cache Invalidation on Populated Document Deletion
    it('should invalidate cache when a populated document is deleted', async () => {
        // Create parent user
        const parent = await UserModel.create({ name: 'Parent', email: 'parent@example.com' });

        // Create child user referencing parent
        const child = await UserModel.create({
            name: 'Child',
            email: 'child@example.com',
            parent: parent._id
        });

        // Query child and populate parent
        const firstResult = await UserModel.findOne({ _id: child._id })
            .cachePopulate({ path: 'parent' })
            .exec();

        expect(firstResult).toBeDefined();
        expect(firstResult!.parent).toBeInstanceOf(mongoose.Document);
        expect((firstResult!.parent as unknown as IUser).name).toBe('Parent');

        // Delete the parent document
        await UserModel.deleteOne({ _id: parent._id });

        // Query child and populate parent again
        const secondResult = await UserModel.findOne({ _id: child._id })
            .cachePopulate({ path: 'parent' })
            .exec();

        expect(secondResult).toBeDefined();
        expect(secondResult!.parent).toBeUndefined(); // Parent should not be found in cache
    });

    // Cache Invalidation on Populated Document Update
it('should invalidate cache when a populated document is updated', async () => {
    // Create parent user
    const parent = await UserModel.create({ name: 'Parent', email: 'parent@example.com' });

    // Create child user referencing parent
    const child = await UserModel.create({
        name: 'Child',
        email: 'child@example.com',
        parent: parent._id
    });

    // Query child and populate parent
    const firstResult = await UserModel.findOne({ _id: child._id })
        .cachePopulate({ path: 'parent' })
        .exec();

    expect(firstResult).toBeDefined();
    expect(firstResult!.parent).toBeInstanceOf(mongoose.Document);
    expect((firstResult!.parent as unknown as IUser).name).toBe('Parent');

    // Update the parent document
    await UserModel.updateOne({ _id: parent._id }, { name: 'UpdatedParent' });

    // Query child and populate parent again
    const secondResult = await UserModel.findOne({ _id: child._id })
        .cachePopulate({ path: 'parent' })
        .exec();

    expect(secondResult).toBeDefined();
    expect(secondResult!.parent).toBeInstanceOf(mongoose.Document);
    expect((secondResult!.parent as unknown as IUser).name).toBe('UpdatedParent');
});

    // Population with Array of References
it('should handle population and caching for array of references', async () => {
    // Create parent users
    const parent1 = await UserModel.create({ name: 'Parent1', email: 'parent1@example.com' });
    const parent2 = await UserModel.create({ name: 'Parent2', email: 'parent2@example.com' });

    // Create child user referencing both parents
    const child = await UserModel.create({
        name: 'Child',
        email: 'child@example.com',
        parents: [parent1._id, parent2._id]
    });

    // Query child and populate parents
    const firstResult = await UserModel.findOne({ _id: child._id })
        .cachePopulate({ path: 'parents' })
        .exec();

    expect(firstResult).toBeDefined();
    expect(firstResult!.parents).toBeInstanceOf(Array);
    expect(firstResult!.parents.length).toBe(2);
    expect(firstResult!.parents[0]).toBeInstanceOf(mongoose.Document);
    expect(firstResult!.parents[1]).toBeInstanceOf(mongoose.Document);
    expect((firstResult!.parents[0] as unknown as IUser).name).toBe('Parent1');
    expect((firstResult!.parents[1] as unknown as IUser).name).toBe('Parent2');

    // Second query: should hit cache, not DB
    const collectionFindSpy = jest.spyOn(mongoose.Collection.prototype, 'find');
    const secondResult = await UserModel.findOne({ _id: child._id })
        .cachePopulate({ path: 'parents' })
        .exec();

    expect(secondResult).toBeDefined();
    expect(secondResult!.parents).toBeInstanceOf(Array);
    expect(secondResult!.parents.length).toBe(2);
    expect(secondResult!.parents[0]).toBeInstanceOf(mongoose.Document);
    expect(secondResult!.parents[1]).toBeInstanceOf(mongoose.Document);
    expect((secondResult!.parents[0] as unknown as IUser).name).toBe('Parent1');
    expect((secondResult!.parents[1] as unknown as IUser).name).toBe('Parent2');
    expect(collectionFindSpy).not.toHaveBeenCalled(); // Should not hit DB
    collectionFindSpy.mockRestore();
});

it('should correctly populate an array of references with broken relations', async () => {
    // Create parent users
    const parent1 = await UserModel.create({ name: 'Parent1', email: 'parent1@example.com' });
    const parent2 = await UserModel.create({ name: 'Parent2', email: 'parent2@example.com' });
    const randomParentId = new mongoose.Types.ObjectId(); // The ID of the parent that does not exist in the DB

    // Create child user referencing both parents
    const child = await UserModel.create({
        name: 'Child',
        email: 'child@example.com',
        parents: [parent1._id, parent2._id, randomParentId],
    });

    // Query child and populate parents
    const query = { _id: child._id };
    const populate = { path: 'parents' };
    const dbResult = await UserModel.findOne(query).populate(populate).exec();
    const cachedResult = await UserModel.findOne(query).cachePopulate(populate).exec();

    expect(dbResult).toBeDefined();
    expect(cachedResult).toBeDefined();
    // Both requests should return only two parents third one must be ignored
    expect(dbResult!.parents.length).toBe(2);
    expect(cachedResult!.parents.length).toBe(2);
});

    // Placeholder: Population with Multiple Models
    it('should handle population and caching for fields referencing different models', async () => {
        // Create instances of different models
        const parentModel = mongoose.model('ParentModel', new mongoose.Schema({
            name: String,
            email: String
        }));

        const childModel = mongoose.model('ChildModel', new mongoose.Schema({
            name: String,
            email: String,
            parent: { type: mongoose.Schema.Types.ObjectId, ref: 'ParentModel' }
        }));

        // Create parent document
        const parent = await parentModel.create({ name: 'Parent', email: 'parent@example.com' });

        // Create child document referencing parent
        const child = await childModel.create({
            name: 'Child',
            email: 'child@example.com',
            parent: parent._id
        });

        // Query child and populate parent
        const firstResult = await childModel.findOne({ _id: child._id })
            .cachePopulate({ path: 'parent' })
            .exec();

        expect(firstResult).toBeDefined();
        expect(firstResult!.parent).toBeInstanceOf(mongoose.Document);
        expect((firstResult!.parent as unknown as IUser).name).toBe('Parent');

        // Second query: should hit cache, not DB
        const collectionFindSpy = jest.spyOn(mongoose.Collection.prototype, 'find');
        const secondResult = await childModel.findOne({ _id: child._id })
            .cachePopulate({ path: 'parent' })
            .exec();

        expect(secondResult).toBeDefined();
        expect(secondResult!.parent).toBeInstanceOf(mongoose.Document);
        expect((secondResult!.parent as unknown as IUser).name).toBe('Parent');
        expect(collectionFindSpy).not.toHaveBeenCalled(); // Should not hit DB
        collectionFindSpy.mockRestore();
    });

    // Placeholder: Population with Custom Projection (select as object)
    it('should handle population with select as object and cache independently', async () => {
        // Create parent user with extra field
        const parent = await UserModel.create({ name: 'ParentObj', email: 'parentobj@example.com', age: 42 });
        // Create child referencing parent
        const child = await UserModel.create({
            name: 'ChildObj',
            email: 'childobj@example.com',
            parent: parent._id
        });

        // First query: populate with select as object { name: 1, email: 1 }
        const resultSelectObj = await UserModel.findOne({ _id: child._id })
            .cachePopulate({ path: 'parent', select: { name: 1, email: 1 } })
            .exec();
        expect(resultSelectObj).toBeDefined();
        expect(resultSelectObj!.parent).toBeDefined();
        const parentSelectObj = resultSelectObj!.parent as unknown as IUser;
        expect(parentSelectObj.name).toBe('ParentObj');
        expect(parentSelectObj.email).toBe('parentobj@example.com');
        expect((parentSelectObj as any).age).toBeUndefined();

        // Second query: populate with select as object { name: 1, email: 1 } (should hit cache)
        const collectionFindSpy = jest.spyOn(mongoose.Collection.prototype, 'find');
        const cachedResultObj = await UserModel.findOne({ _id: child._id })
            .cachePopulate({ path: 'parent', select: { name: 1, email: 1 } })
            .exec();
        expect(cachedResultObj).toBeDefined();
        expect(cachedResultObj!.parent).toBeDefined();
        const cachedParentObj = cachedResultObj!.parent as unknown as IUser;
        expect(cachedParentObj.name).toBe('ParentObj');
        expect(cachedParentObj.email).toBe('parentobj@example.com');
        expect((cachedParentObj as any).age).toBeUndefined();
        expect(collectionFindSpy).not.toHaveBeenCalled();

        // Third query: populate with select as object { name: 1, age: 1 } (should hit DB, not cache)
        collectionFindSpy.mockClear();
        const resultSelectObjExtra = await UserModel.findOne({ _id: child._id })
            .cachePopulate({ path: 'parent', select: { name: 1, age: 1 } })
            .exec();
        expect(resultSelectObjExtra).toBeDefined();
        expect(resultSelectObjExtra!.parent).toBeDefined();
        const parentSelectObjExtra = resultSelectObjExtra!.parent as unknown as IUser;
        // Debug: print the actual parent object
        // eslint-disable-next-line no-console

        expect(parentSelectObjExtra.name).toBe('ParentObj');
        expect(parentSelectObjExtra.email).toBeUndefined();
        expect((parentSelectObjExtra as any).age).toBe(42);
        expect(collectionFindSpy).toHaveBeenCalled();
        collectionFindSpy.mockRestore();

        // Fourth query: populate with no select (should get all fields)
        const resultNoSelectObj = await UserModel.findOne({ _id: child._id })
            .cachePopulate({ path: 'parent' })
            .exec();
        expect(resultNoSelectObj).toBeDefined();
        expect(resultNoSelectObj!.parent).toBeDefined();
        const parentNoSelectObj = resultNoSelectObj!.parent as unknown as IUser;
        expect(parentNoSelectObj.name).toBe('ParentObj');
        expect(parentNoSelectObj.email).toBe('parentobj@example.com');
        expect((parentNoSelectObj as any).age).toBe(42);

        // Ensure cache entries are independent (no cross-contamination)
        expect((parentSelectObj as any).age).toBeUndefined();
        expect((parentSelectObjExtra as any).age).toBe(42);
        expect((parentNoSelectObj as any).age).toBe(42);
    });

    it('should not crash when array ref field is an empty array', async () => {
        const child = await UserModel.create({
            name: 'Child',
            email: 'child@example.com',
            parents: []
        });

        const result = await UserModel.findOne({ _id: child._id })
            .cachePopulate({ path: 'parents' })
            .exec();

        expect(result).toBeDefined();
        expect(result!.parents).toEqual([]);
    });

    it('should not crash when array ref field is undefined', async () => {
        const child = await UserModel.create({
            name: 'Child',
            email: 'child@example.com',
        });

        const result = await UserModel.findOne({ _id: child._id })
            .cachePopulate({ path: 'parents' })
            .exec();

        expect(result).toBeDefined();
        expect(result!.parents).toEqual([]);
    });

    it('should handle find() returning mixed docs where some have array field set and others do not', async () => {
        const parent1 = await UserModel.create({ name: 'Parent1', email: 'p1@example.com' });
        const parent2 = await UserModel.create({ name: 'Parent2', email: 'p2@example.com' });

        const childWith = await UserModel.create({
            name: 'ChildWith',
            email: 'childwith@example.com',
            parents: [parent1._id, parent2._id]
        });
        const childWithout = await UserModel.create({
            name: 'ChildWithout',
            email: 'childwithout@example.com',
        });

        const results = await UserModel.find({ _id: { $in: [childWith._id, childWithout._id] } })
            .cachePopulate({ path: 'parents' })
            .exec();

        expect(results).toHaveLength(2);
        const withParents = results.find(r => r.name === 'ChildWith')!;
        const withoutParents = results.find(r => r.name === 'ChildWithout')!;
        expect(withParents.parents).toHaveLength(2);
        expect((withParents.parents[0] as unknown as IUser).name).toBe('Parent1');
        expect(withoutParents.parents).toEqual([]);
    });

    it('should populate both single and array refs in the same query', async () => {
        const parentSingle = await UserModel.create({ name: 'SingleParent', email: 'single@example.com' });
        const parentArr1 = await UserModel.create({ name: 'ArrParent1', email: 'arr1@example.com' });
        const parentArr2 = await UserModel.create({ name: 'ArrParent2', email: 'arr2@example.com' });

        const child = await UserModel.create({
            name: 'Child',
            email: 'child@example.com',
            parent: parentSingle._id,
            parents: [parentArr1._id, parentArr2._id]
        });

        const result = await UserModel.findOne({ _id: child._id })
            .cachePopulate([
                { path: 'parent' },
                { path: 'parents' }
            ])
            .exec();

        expect(result).toBeDefined();
        expect((result!.parent as unknown as IUser).name).toBe('SingleParent');
        expect(result!.parents).toHaveLength(2);
        expect((result!.parents[0] as unknown as IUser).name).toBe('ArrParent1');
    });

    it('should handle array refs with null entries mixed with valid ids', async () => {
        const parent1 = await UserModel.create({ name: 'Parent1', email: 'p1@example.com' });
        const parent2 = await UserModel.create({ name: 'Parent2', email: 'p2@example.com' });

        const child = await UserModel.create({
            name: 'Child',
            email: 'child@example.com',
            parents: [parent1._id, parent2._id]
        });

        // Manually inject a null into the parents array via raw update
        await mongoose.connection.collection('users').updateOne(
            { _id: child._id },
            { $set: { parents: [parent1._id, null, parent2._id] } }
        );

        const result = await UserModel.findOne({ _id: child._id })
            .cachePopulate({ path: 'parents' })
            .exec();

        expect(result).toBeDefined();
        // Should have the 2 valid parents, null should be filtered out
        expect(result!.parents.length).toBe(2);
        expect((result!.parents[0] as unknown as IUser).name).toBe('Parent1');
        expect((result!.parents[1] as unknown as IUser).name).toBe('Parent2');
    });

});