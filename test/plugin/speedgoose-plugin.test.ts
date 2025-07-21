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
 

describe('SpeedGooseCacheAutoCleaner', () => {
    beforeAll(async () => {
        await setupTestDB();
        applySpeedGooseCacheLayer(mongoose, {});
     });

    beforeEach(async () => {
        await clearTestCache();
        await UserModel.deleteMany({});
    });

    it('should invalidate cache on document update', async () => {
        const user = await UserModel.create({ name: 'InvalidateTest', email: 'invalidate@test.com' });
        
        // Initial query to populate cache
        const firstResult = await UserModel.findOne({ _id: user._id }).cacheQuery()
        expect(firstResult).toBeDefined();

        // Update document
        await UserModel.updateOne({ _id: user._id }, { name: 'UpdatedName' });

        // Query should fetch fresh data
        const secondResult = await UserModel.findOne({ _id: user._id }).cacheQuery()
        expect(secondResult).toBeDefined();
        expect(secondResult!.name).toBe('UpdatedName');
    });

    it('should invalidate parent document cache on child update', async () => {
        // Create parent-child relationship
        const parent = await UserModel.create({ name: 'Parent', email: 'parent@test.com' });
        
        const child = await UserModel.create({
            name: 'Child',
            email: 'child@test.com',
            parent: parent._id
        });

        // Cache parent document
        const firstParent = await UserModel.findById(parent._id).cacheQuery()
        expect(firstParent).toBeDefined();

        // Update child document
        await UserModel.updateOne({ _id: child._id }, { name: 'UpdatedChild' });

        // Verify parent cache is invalidated
        const spy = jest.spyOn(UserModel, 'findById');
        const secondParent = await UserModel.findById(parent._id).cacheQuery()
        
        expect(secondParent).toBeDefined();
        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockRestore();
    });
});