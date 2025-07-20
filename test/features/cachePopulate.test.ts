import mongoose, { Document } from 'mongoose';
import { applySpeedGooseCacheLayer } from '../../src/wrapper';
import { UserModel, setupTestDB, clearTestCache } from '../testUtils';

interface IUser extends Document {
    name: string;
    email: string;
    parent?: mongoose.Types.ObjectId | IUser;
    parents?: mongoose.Types.ObjectId[] | IUser[];
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
        expect(result.parent).toBeInstanceOf(mongoose.Document);
        expect(result.parent.name).toBe('Parent');
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
        expect(result.parents).toHaveLength(2);
        expect(result.parents[0].name).toBe('Parent1');
        expect(result.parents[1].name).toBe('Parent2');
    });
});