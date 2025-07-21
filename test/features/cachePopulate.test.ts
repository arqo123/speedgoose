import mongoose, { Document } from 'mongoose';
import { applySpeedGooseCacheLayer } from '../../src/wrapper';
import { UserModel, setupTestDB, clearTestCache } from '../testUtils';

interface IUser extends Document {
    name: string;
    email: string;
    parent?: mongoose.Types.ObjectId | IUser;
    parents?: mongoose.Types.ObjectId[] | IUser[];

    // TypeScript virtual methods for population
    populate(path: string): Promise<this>;
}

describe('cachePopulate', () => {
    beforeAll(async () => {
        await setupTestDB();
        applySpeedGooseCacheLayer(mongoose, {});
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
        expect(firstResult!.parent.name).toBe('Parent');

        // Update parent document
        await UserModel.updateOne({ _id: parent._id }, { name: 'UpdatedParent' });

        // Subsequent query should bypass cache and get updated parent
        const spy = jest.spyOn(UserModel, 'findOne');
        const secondResult = await UserModel.findOne({ _id: child._id })
            .cachePopulate({ path: 'parent' })
            .exec();

        expect(secondResult).toBeDefined();
        expect(secondResult!.parent.name).toBe('UpdatedParent');
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
        expect(secondParent.parent!.name).toBe('New populated record name');
        spy.mockRestore();
    }, 300000000); // Increase timeout for complex operations
});