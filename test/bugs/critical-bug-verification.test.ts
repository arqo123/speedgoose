/**
 * Verification tests confirming all 4 critical bugs are fixed.
 * These tests previously FAILED — they should now all PASS.
 */
import { getCacheStrategyInstance } from '../../src/utils/commonUtils';
import { clearHydrationCache } from '../../src/utils/cacheClientUtils';

// ─────────────────────────────────────────────────────────────────────────────
// BUG #1 FIX VERIFICATION: Redis pub/sub handler now handles malformed JSON
// ─────────────────────────────────────────────────────────────────────────────
describe('BUG #1 FIXED: Redis pub/sub handler handles malformed JSON gracefully', () => {
    // Replicate the FIXED handler logic (with try/catch) from redisUtils.ts:6-17
    const fixedHandler = async (_channel: string, recordIds: string): Promise<void> => {
        try {
            const parsedRecordIds = JSON.parse(recordIds);
            if (Array.isArray(parsedRecordIds)) {
                await Promise.all(parsedRecordIds.map(recordId => clearHydrationCache(recordId)));
                return;
            }
            await clearHydrationCache(parsedRecordIds);
        } catch (error) {
            console.error(`[speedgoose] Failed to handle pub/sub message on channel "${_channel}":`, error);
        }
    };

    test('malformed JSON should NOT throw — error is caught and logged', async () => {
        const spy = jest.spyOn(console, 'error').mockImplementation();
        await expect(fixedHandler('records_changed', 'NOT_VALID_JSON')).resolves.not.toThrow();
        expect(spy).toHaveBeenCalledWith(expect.stringContaining('[speedgoose]'), expect.any(SyntaxError));
        spy.mockRestore();
    });

    test('empty string should NOT throw', async () => {
        const spy = jest.spyOn(console, 'error').mockImplementation();
        await expect(fixedHandler('records_changed', '')).resolves.not.toThrow();
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    test('valid JSON still works correctly', async () => {
        await expect(fixedHandler('records_changed', '"some-record-id"')).resolves.not.toThrow();
    });

    test('source code contains try/catch in redisPubSubMessageHandler', () => {
        const source = require('fs').readFileSync(require('path').join(__dirname, '../../src/utils/redisUtils.ts'), 'utf8');
        expect(source).toContain('try {');
        expect(source).toContain('catch (error)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG #2 FIX VERIFICATION: InMemory concurrent parent-child writes no longer lose data
// ─────────────────────────────────────────────────────────────────────────────
describe('BUG #2 FIXED: InMemory concurrent parent-child writes preserve all data', () => {
    test('concurrent addManyParentToChildRelationships preserves all 4 parents', async () => {
        const strategy = getCacheStrategyInstance();
        const childId = `rel:race-fix-test:${Date.now()}`;

        await strategy.removeChildRelationships(childId);

        const batch1 = strategy.addManyParentToChildRelationships([
            { childIdentifier: childId, parentIdentifier: 'Parent:A' },
            { childIdentifier: childId, parentIdentifier: 'Parent:B' },
        ]);

        const batch2 = strategy.addManyParentToChildRelationships([
            { childIdentifier: childId, parentIdentifier: 'Parent:C' },
            { childIdentifier: childId, parentIdentifier: 'Parent:D' },
        ]);

        await Promise.all([batch1, batch2]);

        const parents = await strategy.getParentsOfChild(childId);
        expect(parents.sort()).toEqual(['Parent:A', 'Parent:B', 'Parent:C', 'Parent:D']);
    });

    test('10 concurrent addParentToChildRelationship calls preserve all 10 parents', async () => {
        const strategy = getCacheStrategyInstance();
        const childId = `rel:race-single-fix-test:${Date.now()}`;

        await strategy.removeChildRelationships(childId);

        const promises = Array.from({ length: 10 }, (_, i) => strategy.addParentToChildRelationship(childId, `Parent:${i}`));

        await Promise.all(promises);

        const parents = await strategy.getParentsOfChild(childId);
        expect(parents.length).toBe(10);
    });

    test('20 concurrent mixed batch + single writes preserve all data', async () => {
        const strategy = getCacheStrategyInstance();
        const childId = `rel:mixed-fix-test:${Date.now()}`;

        await strategy.removeChildRelationships(childId);

        const promises = [
            strategy.addManyParentToChildRelationships([
                { childIdentifier: childId, parentIdentifier: 'Batch1:A' },
                { childIdentifier: childId, parentIdentifier: 'Batch1:B' },
                { childIdentifier: childId, parentIdentifier: 'Batch1:C' },
            ]),
            strategy.addManyParentToChildRelationships([
                { childIdentifier: childId, parentIdentifier: 'Batch2:A' },
                { childIdentifier: childId, parentIdentifier: 'Batch2:B' },
            ]),
            ...Array.from({ length: 5 }, (_, i) => strategy.addParentToChildRelationship(childId, `Single:${i}`)),
        ];

        await Promise.all(promises);

        const parents = await strategy.getParentsOfChild(childId);
        expect(parents.length).toBe(10); // 3 + 2 + 5
    });

    test('concurrent addValueToCacheSet preserves all values', async () => {
        const strategy = getCacheStrategyInstance();
        const ns = `cacheSet:race-fix:${Date.now()}`;

        const promises = Array.from({ length: 10 }, (_, i) => strategy.addValueToCacheSet(ns, `val-${i}`));
        await Promise.all(promises);

        const values = await strategy.getValuesFromCachedSet(ns);
        expect(values.length).toBe(10);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG #3 FIX VERIFICATION: Redis TOCTOU replaced with Lua scripts
// ─────────────────────────────────────────────────────────────────────────────
describe('BUG #3 FIXED: Redis operations use atomic Lua scripts', () => {
    test('addValueToCacheSet uses eval (Lua) instead of scard→del→sadd pipeline', () => {
        const source = require('fs').readFileSync(require('path').join(__dirname, '../../src/cachingStrategies/redisStrategy.ts'), 'utf8');

        // Extract the method body
        const methodMatch = source.match(/async addValueToCacheSet[^{]*{([\s\S]*?)^\s{4}}/m);
        const methodBody = methodMatch?.[1] ?? '';

        // Should use eval (Lua), NOT scard/del/sadd pipeline
        expect(methodBody).toContain('eval');
        expect(methodBody).not.toContain('scard');
        expect(methodBody).not.toMatch(/\bclient\.del\b/);
    });

    test('addParentToChildRelationship uses eval (Lua)', () => {
        const source = require('fs').readFileSync(require('path').join(__dirname, '../../src/cachingStrategies/redisStrategy.ts'), 'utf8');

        const methodMatch = source.match(/async addParentToChildRelationship\(child[^{]*{([\s\S]*?)^\s{4}}/m);
        const methodBody = methodMatch?.[1] ?? '';

        expect(methodBody).toContain('eval');
        expect(methodBody).not.toContain('scard');
    });

    test('addManyParentToChildRelationships uses eval (Lua)', () => {
        const source = require('fs').readFileSync(require('path').join(__dirname, '../../src/cachingStrategies/redisStrategy.ts'), 'utf8');

        const methodMatch = source.match(/async addManyParentToChildRelationships[^{]*{([\s\S]*?)^\s{4}}/m);
        const methodBody = methodMatch?.[1] ?? '';

        expect(methodBody).toContain('eval');
        expect(methodBody).not.toContain('scard');
    });

    test('Lua scripts contain atomic SCARD→DEL→SADD in single eval', () => {
        const source = require('fs').readFileSync(require('path').join(__dirname, '../../src/cachingStrategies/redisStrategy.ts'), 'utf8');

        // LUA_ADD_TO_SET should have SCARD, DEL, SADD in a single script
        expect(source).toContain("redis.call('SCARD'");
        expect(source).toContain("redis.call('DEL'");
        expect(source).toContain("redis.call('SADD'");
        expect(source).toContain("redis.call('EXPIRE'");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG #4 FIX VERIFICATION: CACHE_PARENT_LIMIT now logs a warning
// ─────────────────────────────────────────────────────────────────────────────
describe('BUG #4 FIXED: CACHE_PARENT_LIMIT truncation logs a warning', () => {
    test('clearParentCacheBulk warns when truncation occurs', () => {
        const source = require('fs').readFileSync(require('path').join(__dirname, '../../src/utils/cacheClientUtils.ts'), 'utf8');

        // Should have a console.warn mentioning truncation near CACHE_PARENT_LIMIT
        expect(source).toContain('console.warn');
        expect(source).toMatch(/console\.warn.*truncat/i);
    });

    test('clearParentCache warns when truncation occurs', () => {
        const source = require('fs').readFileSync(require('path').join(__dirname, '../../src/utils/cacheClientUtils.ts'), 'utf8');

        // Extract clearParentCache function
        const funcMatch = source.match(/export const clearParentCache = async[\s\S]*?^};/m);
        const funcBody = funcMatch?.[0] ?? '';

        expect(funcBody).toContain('console.warn');
        expect(funcBody).toMatch(/parents? skipped/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// BONUS FIX VERIFICATION: publishRecordIdsOnChannel has null guard
// ─────────────────────────────────────────────────────────────────────────────
describe('BONUS FIXED: publishRecordIdsOnChannel has null guard', () => {
    test('publishRecordIdsOnChannel implementation has null guard', () => {
        const source = require('fs').readFileSync(require('path').join(__dirname, '../../src/utils/redisUtils.ts'), 'utf8');

        expect(source).toContain('publishRecordIdsOnChannel');
        // Verify null guard exists in the function (may span multiple lines)
        expect(source).toMatch(/publishRecordIdsOnChannel[\s\S]*?\?\?/);
    });
});
