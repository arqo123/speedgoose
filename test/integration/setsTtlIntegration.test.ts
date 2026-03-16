import mongoose from 'mongoose';
import Container from 'typedi';
import { applySpeedGooseCacheLayer } from '../../src/wrapper';
import { setupTestDB, UserModel, clearTestCache } from '../testUtils';
import { getCacheStrategyInstance, getConfig } from '../../src/utils/commonUtils';
import { SpeedGooseConfig, GlobalDiContainerRegistryNames } from '../../src/types/types';

/**
 * Integration tests for invalidation set TTL and cardinality (issue #168).
 *
 * Verifies that:
 * 1. Config values (setsTtl, maxSetCardinality) propagate to Redis operations
 * 2. Defaults are computed correctly (2x defaultTtl, 10000)
 * 3. cacheQuery correctly passes TTL to model and record invalidation sets
 * 4. cachePopulate correctly passes TTL to relationship sets
 * 5. Disabled (0) values are passed through correctly
 */

describe('Invalidation sets TTL integration', () => {
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
    });

    const setConfig = (overrides: Partial<SpeedGooseConfig>) => {
        const current = getConfig() ?? {};
        Container.set<SpeedGooseConfig>(GlobalDiContainerRegistryNames.CONFIG_GLOBAL_ACCESS, { ...current, ...overrides });
    };

    afterEach(() => {
        // Reset to default config
        setConfig({ setsTtl: undefined, maxSetCardinality: undefined, defaultTtl: 60 });
    });

    // ────────────────────────────────────────────
    // Default config
    // ────────────────────────────────────────────

    describe('default config (setsTtl undefined, maxSetCardinality undefined)', () => {
        test('should use 2x defaultTtl = 120 for invalidation sets', async () => {
            const cacheStrategy = getCacheStrategyInstance();
            const spy = jest.spyOn(cacheStrategy, 'addValueToCacheSet');

            await UserModel.create({ name: 'default-test', email: 'def@test.com' });
            await (UserModel.find({ name: 'default-test' }) as any).cacheQuery({ cacheKey: 'default-ttl-test' });

            expect(spy).toHaveBeenCalled();
            const call = spy.mock.calls[0];
            expect(call[2]).toBe(120); // 2 * 60 (defaultTtl)
            expect(call[3]).toBe(10000); // default maxSetCardinality

            spy.mockRestore();
        });

        test('should pass same defaults to addValueToManyCachedSets for record cache', async () => {
            const cacheStrategy = getCacheStrategyInstance();
            const spy = jest.spyOn(cacheStrategy, 'addValueToManyCachedSets');

            await UserModel.create({ name: 'record-default', email: 'rd@test.com' });
            await (UserModel.find({ name: 'record-default' }) as any).cacheQuery({ cacheKey: 'record-default-test' });

            expect(spy).toHaveBeenCalled();
            const call = spy.mock.calls[0];
            expect(call[2]).toBe(120);
            expect(call[3]).toBe(10000);

            spy.mockRestore();
        });

        test('should compute correct defaults for relationship set helpers', () => {
            // Verify that the shared helpers return correct defaults for relationship sets
            // (the actual relationship call is tested in populationUtils.test.ts)
            const { getSetsTtl, getMaxSetCardinality } = require('../../src/utils/cacheClientUtils');
            expect(getSetsTtl()).toBe(120); // 2 * 60 (defaultTtl)
            expect(getMaxSetCardinality()).toBe(10000);
        });
    });

    // ────────────────────────────────────────────
    // Custom config
    // ────────────────────────────────────────────

    describe('custom config (setsTtl: 600, maxSetCardinality: 5000)', () => {
        beforeEach(() => {
            setConfig({ setsTtl: 600, maxSetCardinality: 5000 });
        });

        test('should use custom setsTtl for model cache sets', async () => {
            const cacheStrategy = getCacheStrategyInstance();
            const spy = jest.spyOn(cacheStrategy, 'addValueToCacheSet');

            await UserModel.create({ name: 'custom-ttl', email: 'ct@test.com' });
            await (UserModel.find({ name: 'custom-ttl' }) as any).cacheQuery({ cacheKey: 'custom-sets-ttl' });

            expect(spy).toHaveBeenCalled();
            expect(spy.mock.calls[0][2]).toBe(600);
            expect(spy.mock.calls[0][3]).toBe(5000);

            spy.mockRestore();
        });

        test('should use custom values for record cache sets', async () => {
            const cacheStrategy = getCacheStrategyInstance();
            const spy = jest.spyOn(cacheStrategy, 'addValueToManyCachedSets');

            await UserModel.create({ name: 'custom-card', email: 'cc@test.com' });
            await (UserModel.find({ name: 'custom-card' }) as any).cacheQuery({ cacheKey: 'custom-card-test' });

            expect(spy).toHaveBeenCalled();
            expect(spy.mock.calls[0][2]).toBe(600);
            expect(spy.mock.calls[0][3]).toBe(5000);

            spy.mockRestore();
        });
    });

    // ────────────────────────────────────────────
    // Disabled (0)
    // ────────────────────────────────────────────

    describe('disabled config (setsTtl: 0, maxSetCardinality: 0)', () => {
        beforeEach(() => {
            setConfig({ setsTtl: 0, maxSetCardinality: 0 });
        });

        test('should pass 0 as setsTtl when disabled', async () => {
            const cacheStrategy = getCacheStrategyInstance();
            const spy = jest.spyOn(cacheStrategy, 'addValueToCacheSet');

            await UserModel.create({ name: 'disabled-ttl', email: 'dt@test.com' });
            await (UserModel.find({ name: 'disabled-ttl' }) as any).cacheQuery({ cacheKey: 'disabled-ttl-test' });

            expect(spy).toHaveBeenCalled();
            expect(spy.mock.calls[0][2]).toBe(0);
            expect(spy.mock.calls[0][3]).toBe(0);

            spy.mockRestore();
        });
    });

    // ────────────────────────────────────────────
    // Custom defaultTtl affects computed setsTtl
    // ────────────────────────────────────────────

    describe('custom defaultTtl affects computed setsTtl', () => {
        beforeEach(() => {
            setConfig({ setsTtl: undefined, defaultTtl: 300 });
        });

        test('should compute setsTtl as 2x defaultTtl when setsTtl is not configured', async () => {
            const cacheStrategy = getCacheStrategyInstance();
            const spy = jest.spyOn(cacheStrategy, 'addValueToCacheSet');

            await UserModel.create({ name: 'computed-ttl', email: 'comp@test.com' });
            await (UserModel.find({ name: 'computed-ttl' }) as any).cacheQuery({ cacheKey: 'computed-ttl-test' });

            expect(spy).toHaveBeenCalled();
            expect(spy.mock.calls[0][2]).toBe(600); // 2 * 300

            spy.mockRestore();
        });
    });
});
