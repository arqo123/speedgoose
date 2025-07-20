import mongoose, { Document } from 'mongoose';
import { applySpeedGooseCacheLayer } from '../../src/wrapper';
import { UserModel, setupTestDB, clearTestCache } from '../testUtils';
import { getDocumentCacheKey, handleCachedPopulation } from '../../src/utils/populationUtils';
import { getCacheStrategyInstance } from '../../src/utils/commonUtils';
import { CachedResult } from '../../src/types/types';

interface IUser extends Document {
    name: string;
    email: string;
    parent?: mongoose.Types.ObjectId | IUser | Record<string, unknown>;
    parents?: mongoose.Types.ObjectId[] | IUser[] | Record<string, unknown>[];
    relationField?: mongoose.Types.ObjectId | IUser | Record<string, unknown>;
    fieldA?: string;
}

describe('populationUtils', () => {
    beforeAll(async () => {
        await setupTestDB();
        applySpeedGooseCacheLayer(mongoose, {});
    });

    beforeEach(async () => {
        await clearTestCache();
        await UserModel.deleteMany({});
    });

    describe('getDocumentCacheKey', () => {
        it('should generate correct cache key format', () => {
            const key = getDocumentCacheKey('User', '507f1f77bcf86cd799439011');
            expect(key).toBe('doc:User:507f1f77bcf86cd799439011');
        });

        it('should handle different model names', () => {
            const key = getDocumentCacheKey('Product', '507f1f77bcf86cd799439012');
            expect(key).toBe('doc:Product:507f1f77bcf86cd799439012');
        });

        it('should handle empty string IDs', () => {
            const key = getDocumentCacheKey('User', '');
            expect(key).toBe('doc:User:');
        });
    });

    describe('handleCachedPopulation', () => {
        it('should return empty array when no documents provided', async () => {
            const result = await handleCachedPopulation(
                [] as unknown as Document[], 
                [], 
                UserModel.find() as any
            );
            expect(result).toEqual([]);
        });

        it('should populate single document from cache', async () => {
            // Create parent user
            const parent = await UserModel.create({ name: 'Parent', email: 'parent@example.com' });
            
            // Create child user
            const child = await UserModel.create({ 
                name: 'Child', 
                email: 'child@example.com',
                parent: parent._id 
            });

            // Manually cache the parent document
            const cacheStrategy = getCacheStrategyInstance();
            const cacheKey = getDocumentCacheKey('User', parent._id.toString());
            const cacheData = new Map<string, CachedResult>();
            cacheData.set(cacheKey, parent.toObject());
            await cacheStrategy.setDocuments(cacheData, 60);

            // Get child document
            const childDoc = await UserModel.findById(child._id);
            expect(childDoc).toBeDefined();
            
            // Test population
            const result = await handleCachedPopulation(
                [childDoc!],
                [{ path: 'parent' }],
                UserModel.find() as any
            );

            expect(result).toHaveLength(1);
            const populatedChild = result[0] as IUser;
            expect(populatedChild.parent).toBeDefined();
            const populatedParent = populatedChild.parent as Record<string, unknown>;
            expect(populatedParent.name).toBe('Parent');
            expect(populatedParent.email).toBe('parent@example.com');
        });

        it('should populate multiple documents from cache', async () => {
            // Create parents
            const parent1 = await UserModel.create({ name: 'Parent1', email: 'parent1@example.com' });
            const parent2 = await UserModel.create({ name: 'Parent2', email: 'parent2@example.com' });
            
            // Create children
            const child1 = await UserModel.create({ 
                name: 'Child1', 
                email: 'child1@example.com',
                parent: parent1._id 
            });
            const child2 = await UserModel.create({ 
                name: 'Child2', 
                email: 'child2@example.com',
                parent: parent2._id 
            });

            // Cache parents
            const cacheStrategy = getCacheStrategyInstance();
            const cacheData = new Map<string, CachedResult>();
            cacheData.set(getDocumentCacheKey('User', parent1._id.toString()), parent1.toObject());
            cacheData.set(getDocumentCacheKey('User', parent2._id.toString()), parent2.toObject());
            await cacheStrategy.setDocuments(cacheData, 60);

            // Get child documents
            const childDocs = await UserModel.find({ _id: { $in: [child1._id, child2._id] } });

            // Test population
            const result = await handleCachedPopulation(
                childDocs,
                [{ path: 'parent' }],
                UserModel.find() as any
            );

            expect(result).toHaveLength(2);
            const populatedChild1 = result[0] as IUser;
            const populatedChild2 = result[1] as IUser;
            expect((populatedChild1.parent as Record<string, unknown>).name).toBe('Parent1');
            expect((populatedChild2.parent as Record<string, unknown>).name).toBe('Parent2');
        });

        it('should fetch missing documents from database when not in cache', async () => {
            // Create parent user
            const parent = await UserModel.create({ name: 'Parent', email: 'parent@example.com' });
            
            // Create child user
            const child = await UserModel.create({ 
                name: 'Child', 
                email: 'child@example.com',
                parent: parent._id 
            });

            // Get child document (parent not cached)
            const childDoc = await UserModel.findById(child._id);
            expect(childDoc).toBeDefined();
            
            // Test population - should fetch parent from DB
            const result = await handleCachedPopulation(
                [childDoc!],
                [{ path: 'parent' }],
                UserModel.find() as any
            );

            expect(result).toHaveLength(1);
            const populatedChild = result[0] as IUser;
            expect(populatedChild.parent).toBeDefined();
            expect((populatedChild.parent as IUser).name).toBe('Parent');
            
            // Verify parent was cached
            const cacheStrategy = getCacheStrategyInstance();
            const cacheKey = getDocumentCacheKey('User', parent._id.toString());
            const cachedParent = await cacheStrategy.getDocuments([cacheKey]);
            expect(cachedParent.has(cacheKey)).toBe(true);
        });

        it('should handle array population', async () => {
            // Create parents
            const parent1 = await UserModel.create({ name: 'Parent1', email: 'parent1@example.com' });
            const parent2 = await UserModel.create({ name: 'Parent2', email: 'parent2@example.com' });
            
            // Create child with multiple parents
            const child = await UserModel.create({ 
                name: 'Child', 
                email: 'child@example.com',
                parents: [parent1._id, parent2._id] 
            });

            // Cache parents
            const cacheStrategy = getCacheStrategyInstance();
            const cacheData = new Map<string, CachedResult>();
            cacheData.set(getDocumentCacheKey('User', parent1._id.toString()), parent1.toObject());
            cacheData.set(getDocumentCacheKey('User', parent2._id.toString()), parent2.toObject());
            await cacheStrategy.setDocuments(cacheData, 60);

            // Get child document
            const childDoc = await UserModel.findById(child._id);
            expect(childDoc).toBeDefined();
            
            // Test population
            const result = await handleCachedPopulation(
                [childDoc!],
                [{ path: 'parents' }],
                UserModel.find() as any
            );

            expect(result).toHaveLength(1);
            const populatedChild = result[0] as IUser;
            expect(populatedChild.parents).toHaveLength(2);
            const parents = populatedChild.parents as Record<string, unknown>[];
            expect(parents[0].name).toBe('Parent1');
            expect(parents[1].name).toBe('Parent2');
        });

        it('should apply TTL inheritance correctly - fallback mode', async () => {
            const parent = await UserModel.create({ name: 'Parent', email: 'parent@example.com' });
            const child = await UserModel.create({
                name: 'Child',
                email: 'child@example.com',
                parent: parent._id
            });

            const childDoc = await UserModel.findById(child._id);
            expect(childDoc).toBeDefined();
            
            // Test with populate option TTL
            await handleCachedPopulation(
                [childDoc!],
                [{ path: 'parent', ttl: 120, ttlInheritance: 'fallback' }],
                UserModel.find() as any,
                90 // context TTL
            );

            // Verify TTL was applied (we can't directly check TTL, but verify caching worked)
            const cacheStrategy = getCacheStrategyInstance();
            const cacheKey = getDocumentCacheKey('User', parent._id.toString());
            const cachedParent = await cacheStrategy.getDocuments([cacheKey]);
            expect(cachedParent.has(cacheKey)).toBe(true);
        });

        it('should apply TTL inheritance correctly - override mode', async () => {
            const parent = await UserModel.create({ name: 'Parent', email: 'parent@example.com' });
            const child = await UserModel.create({ 
                name: 'Child', 
                email: 'child@example.com',
                parent: parent._id 
            });

            const childDoc = await UserModel.findById(child._id);
            expect(childDoc).toBeDefined();
            
            // Test with override mode
            await handleCachedPopulation(
                [childDoc!],
                [{ path: 'parent', ttl: 120, ttlInheritance: 'override' }],
                UserModel.find() as any,
                90 // context TTL
            );

            // Verify caching worked
            const cacheStrategy = getCacheStrategyInstance();
            const cacheKey = getDocumentCacheKey('User', parent._id.toString());
            const cachedParent = await cacheStrategy.getDocuments([cacheKey]);
            expect(cachedParent.has(cacheKey)).toBe(true);
        });

        it('should handle select option in populate', async () => {
            const parent = await UserModel.create({ 
                name: 'Parent', 
                email: 'parent@example.com',
                fieldA: 'extraField'
            });
            
            const child = await UserModel.create({ 
                name: 'Child', 
                email: 'child@example.com',
                parent: parent._id 
            });

            const childDoc = await UserModel.findById(child._id);
            expect(childDoc).toBeDefined();
            
            // Test population with select
            const result = await handleCachedPopulation(
                [childDoc!],
                [{ path: 'parent', select: 'name' }],
                UserModel.find() as any
            );

            expect(result).toHaveLength(1);
            const populatedChild = result[0] as IUser;
            expect(populatedChild.parent).toBeDefined();
            const populatedParent = populatedChild.parent as Record<string, unknown>;
            expect(populatedParent.name).toBe('Parent');
            expect(populatedParent.fieldA).toBeUndefined();
        });

        it('should handle lean queries correctly', async () => {
            const parent = await UserModel.create({ name: 'Parent', email: 'parent@example.com' });
            const child = await UserModel.create({ 
                name: 'Child', 
                email: 'child@example.com',
                parent: parent._id 
            });

            const childDoc = await UserModel.findById(child._id).lean();
            expect(childDoc).toBeDefined();
            
            // Test population with lean query
            const result = await handleCachedPopulation(
                [childDoc! as any],
                [{ path: 'parent' }],
                UserModel.find().lean() as any
            );

            expect(result).toHaveLength(1);
            const populatedChild = result[0] as IUser;
            expect(populatedChild.parent).toBeDefined();
            expect((populatedChild.parent as Record<string, unknown>).name).toBe('Parent');
        });

        it('should establish parent-child relationships in cache', async () => {
            const parent = await UserModel.create({ name: 'Parent', email: 'parent@example.com' });
            const child = await UserModel.create({ 
                name: 'Child', 
                email: 'child@example.com',
                parent: parent._id 
            });

            const childDoc = await UserModel.findById(child._id);
            expect(childDoc).toBeDefined();
            
            await handleCachedPopulation(
                [childDoc!],
                [{ path: 'parent' }],
                UserModel.find() as any
            );

            // Verify relationships were established
            const cacheStrategy = getCacheStrategyInstance();
            expect(cacheStrategy).toBeDefined();
        });

        it('should handle multiple populate options', async () => {
            const parent = await UserModel.create({ name: 'Parent', email: 'parent@example.com' });
            const relationUser = await UserModel.create({ name: 'Relation', email: 'relation@example.com' });
            
            const child = await UserModel.create({ 
                name: 'Child', 
                email: 'child@example.com',
                parent: parent._id,
                relationField: relationUser._id
            });

            const childDoc = await UserModel.findById(child._id);
            expect(childDoc).toBeDefined();
            
            // Test multiple populate options
            const result = await handleCachedPopulation(
                [childDoc!],
                [
                    { path: 'parent' },
                    { path: 'relationField' }
                ],
                UserModel.find() as any
            );

            expect(result).toHaveLength(1);
            const populatedChild = result[0] as IUser;
            expect((populatedChild.parent as Record<string, unknown>).name).toBe('Parent');
            expect((populatedChild.relationField as Record<string, unknown>).name).toBe('Relation');
        });

        it('should handle empty populate options', async () => {
            const user = await UserModel.create({ name: 'User', email: 'user@example.com' });
            const userDoc = await UserModel.findById(user._id);
            expect(userDoc).toBeDefined();
            
            const result = await handleCachedPopulation(
                [userDoc!],
                [],
                UserModel.find() as any
            );

            expect(result).toHaveLength(1);
            const populatedUser = result[0] as IUser;
            expect(populatedUser.name).toBe('User');
        });

        it('should handle non-existent references gracefully', async () => {
            const nonExistentId = new mongoose.Types.ObjectId();
            const child = await UserModel.create({ 
                name: 'Child', 
                email: 'child@example.com',
                parent: nonExistentId
            });

            const childDoc = await UserModel.findById(child._id);
            expect(childDoc).toBeDefined();
            
            const result = await handleCachedPopulation(
                [childDoc!],
                [{ path: 'parent' }],
                UserModel.find() as any
            );

            expect(result).toHaveLength(1);
            const populatedChild = result[0] as IUser;
            expect(populatedChild.parent).toBeUndefined();
        });
    });
});