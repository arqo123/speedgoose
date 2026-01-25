import mongoose from 'mongoose';
import Container from 'typedi';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { SpeedGooseCacheAutoCleaner } from '../../src/plugin/SpeedGooseCacheAutoCleaner';
import { applySpeedGooseCacheLayer } from '../../src/wrapper';
import { GlobalDiContainerRegistryNames } from '../../src/types/types';

/**
 * Test for GitHub Issue #151
 * When caching is disabled (enabled: false), SpeedGooseCacheAutoCleaner hooks
 * should not throw "Service with speedGooseConfigAccess identifier was not found"
 */
describe('SpeedGooseCacheAutoCleaner with caching disabled (Issue #151)', () => {
    let mongoServer: MongoMemoryServer;
    let testConnection: mongoose.Connection;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        const uri = mongoServer.getUri();
        testConnection = await mongoose.createConnection(uri).asPromise();
    });

    afterAll(async () => {
        await testConnection.close();
        await mongoServer.stop();
    });

    describe('when applySpeedGooseCacheLayer is called with enabled: false', () => {
        let TestModel: mongoose.Model<any>;

        beforeAll(() => {
            // Apply speedgoose with caching disabled
            applySpeedGooseCacheLayer(mongoose, { enabled: false });

            // Create schema with SpeedGooseCacheAutoCleaner plugin
            const testSchema = new mongoose.Schema({
                name: String,
                email: String,
            });
            testSchema.plugin(SpeedGooseCacheAutoCleaner);

            TestModel = testConnection.model('TestDisabledCache', testSchema);
        });

        afterEach(async () => {
            await TestModel.deleteMany({});
        });

        it('should not throw error on findByIdAndUpdate', async () => {
            const doc = await TestModel.create({ name: 'Test', email: 'test@test.com' });

            // This should NOT throw "Service with speedGooseConfigAccess identifier was not found"
            await expect(
                TestModel.findByIdAndUpdate(doc._id, { name: 'Updated' })
            ).resolves.toBeDefined();
        });

        it('should not throw error on findOneAndUpdate', async () => {
            const doc = await TestModel.create({ name: 'Test', email: 'test@test.com' });

            await expect(
                TestModel.findOneAndUpdate({ _id: doc._id }, { name: 'Updated' })
            ).resolves.toBeDefined();
        });

        it('should not throw error on updateOne', async () => {
            const doc = await TestModel.create({ name: 'Test', email: 'test@test.com' });

            await expect(
                TestModel.updateOne({ _id: doc._id }, { name: 'Updated' })
            ).resolves.toBeDefined();
        });

        it('should not throw error on updateMany', async () => {
            await TestModel.create({ name: 'Test1', email: 'test1@test.com' });
            await TestModel.create({ name: 'Test2', email: 'test2@test.com' });

            await expect(
                TestModel.updateMany({}, { name: 'Updated' })
            ).resolves.toBeDefined();
        });

        it('should not throw error on deleteOne', async () => {
            const doc = await TestModel.create({ name: 'Test', email: 'test@test.com' });

            await expect(
                TestModel.deleteOne({ _id: doc._id })
            ).resolves.toBeDefined();
        });

        it('should not throw error on deleteMany', async () => {
            await TestModel.create({ name: 'Test1', email: 'test1@test.com' });
            await TestModel.create({ name: 'Test2', email: 'test2@test.com' });

            await expect(
                TestModel.deleteMany({})
            ).resolves.toBeDefined();
        });

        it('should not throw error on findByIdAndDelete', async () => {
            const doc = await TestModel.create({ name: 'Test', email: 'test@test.com' });

            await expect(
                TestModel.findByIdAndDelete(doc._id)
            ).resolves.toBeDefined();
        });

        it('should not throw error on document save', async () => {
            const doc = new TestModel({ name: 'Test', email: 'test@test.com' });

            await expect(doc.save()).resolves.toBeDefined();
        });

        it('should not throw error on insertMany', async () => {
            await expect(
                TestModel.insertMany([
                    { name: 'Test1', email: 'test1@test.com' },
                    { name: 'Test2', email: 'test2@test.com' },
                ])
            ).resolves.toBeDefined();
        });

        it('should complete operations successfully when caching is disabled', async () => {
            // Create
            const doc = await TestModel.create({ name: 'Original', email: 'test@test.com' });
            expect(doc.name).toBe('Original');

            // Update
            const updated = await TestModel.findByIdAndUpdate(
                doc._id,
                { name: 'Updated' },
                { new: true }
            );
            expect(updated?.name).toBe('Updated');

            // Delete
            await TestModel.findByIdAndDelete(doc._id);
            const deleted = await TestModel.findById(doc._id);
            expect(deleted).toBeNull();
        });
    });

    describe('when DI container has no config registered at all', () => {
        let TestModelNoConfig: mongoose.Model<any>;

        beforeAll(() => {
            // Remove config from DI container to simulate uninitialized state
            Container.remove(GlobalDiContainerRegistryNames.CONFIG_GLOBAL_ACCESS);

            // Create schema with SpeedGooseCacheAutoCleaner plugin
            const testSchema = new mongoose.Schema({
                name: String,
                value: Number,
            });
            testSchema.plugin(SpeedGooseCacheAutoCleaner);

            TestModelNoConfig = testConnection.model('TestNoConfig', testSchema);
        });

        afterEach(async () => {
            await TestModelNoConfig.deleteMany({});
        });

        afterAll(() => {
            // Restore config for other tests
            applySpeedGooseCacheLayer(mongoose, { enabled: true });
        });

        it('should not throw error when config is not registered', async () => {
            const doc = await TestModelNoConfig.create({ name: 'Test', value: 42 });

            // These should NOT throw "Service with speedGooseConfigAccess identifier was not found"
            await expect(
                TestModelNoConfig.findByIdAndUpdate(doc._id, { value: 100 })
            ).resolves.toBeDefined();

            await expect(
                TestModelNoConfig.updateMany({}, { value: 200 })
            ).resolves.toBeDefined();
        });
    });
});
