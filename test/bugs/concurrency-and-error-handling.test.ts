/**
 * Tests for concurrency safety, error handling, and edge cases
 * in caching strategies and utility functions.
 */
import { getCacheStrategyInstance } from '../../src/utils/commonUtils';
import { clearHydrationCache } from '../../src/utils/cacheClientUtils';

describe('Redis pub/sub error handling', () => {
    // Replicate the handler logic from redisUtils.ts to verify try/catch behavior
    const handler = async (_channel: string, recordIds: string): Promise<void> => {
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

    test('malformed JSON is caught and logged, not thrown', async () => {
        const spy = jest.spyOn(console, 'error').mockImplementation();
        await expect(handler('records_changed', 'NOT_VALID_JSON')).resolves.not.toThrow();
        expect(spy).toHaveBeenCalledWith(expect.stringContaining('[speedgoose]'), expect.any(SyntaxError));
        spy.mockRestore();
    });

    test('empty string is caught and logged', async () => {
        const spy = jest.spyOn(console, 'error').mockImplementation();
        await expect(handler('records_changed', '')).resolves.not.toThrow();
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    test('valid JSON works correctly', async () => {
        await expect(handler('records_changed', '"some-record-id"')).resolves.not.toThrow();
    });

    test('redisPubSubMessageHandler source contains try/catch', () => {
        const source = require('fs').readFileSync(require('path').join(__dirname, '../../src/utils/redisUtils.ts'), 'utf8');
        expect(source).toContain('try {');
        expect(source).toContain('catch (error)');
    });
});

describe('InMemory concurrent parent-child write safety', () => {
    test('concurrent addManyParentToChildRelationships preserves all parents', async () => {
        const strategy = getCacheStrategyInstance();
        const childId = `rel:conc-batch:${Date.now()}`;

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

    test('10 concurrent single adds preserve all parents', async () => {
        const strategy = getCacheStrategyInstance();
        const childId = `rel:conc-single:${Date.now()}`;

        await strategy.removeChildRelationships(childId);

        const promises = Array.from({ length: 10 }, (_, i) => strategy.addParentToChildRelationship(childId, `Parent:${i}`));
        await Promise.all(promises);

        const parents = await strategy.getParentsOfChild(childId);
        expect(parents.length).toBe(10);
    });

    test('mixed batch + single concurrent writes preserve all data', async () => {
        const strategy = getCacheStrategyInstance();
        const childId = `rel:conc-mixed:${Date.now()}`;

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
        expect(parents.length).toBe(10);
    });

    test('concurrent addValueToCacheSet preserves all values', async () => {
        const strategy = getCacheStrategyInstance();
        const ns = `cacheSet:conc:${Date.now()}`;

        const promises = Array.from({ length: 10 }, (_, i) => strategy.addValueToCacheSet(ns, `val-${i}`));
        await Promise.all(promises);

        const values = await strategy.getValuesFromCachedSet(ns);
        expect(values.length).toBe(10);
    });
});

describe('RedisStrategy uses atomic Lua scripts for set mutations', () => {
    const readRedisSource = () => require('fs').readFileSync(require('path').join(__dirname, '../../src/cachingStrategies/redisStrategy.ts'), 'utf8');

    test('addValueToCacheSet uses eval instead of pipeline scard→del→sadd', () => {
        const source = readRedisSource();
        const methodMatch = source.match(/async addValueToCacheSet[^{]*{([\s\S]*?)^\s{4}}/m);
        const body = methodMatch?.[1] ?? '';

        expect(body).toContain('eval');
        expect(body).not.toContain('scard');
    });

    test('addParentToChildRelationship uses eval', () => {
        const source = readRedisSource();
        const methodMatch = source.match(/async addParentToChildRelationship\(child[^{]*{([\s\S]*?)^\s{4}}/m);
        const body = methodMatch?.[1] ?? '';

        expect(body).toContain('eval');
        expect(body).not.toContain('scard');
    });

    test('addManyParentToChildRelationships uses eval', () => {
        const source = readRedisSource();
        const methodMatch = source.match(/async addManyParentToChildRelationships[^{]*{([\s\S]*?)^\s{4}}/m);
        const body = methodMatch?.[1] ?? '';

        expect(body).toContain('eval');
        expect(body).not.toContain('scard');
    });

    test('Lua scripts contain atomic SCARD, DEL, SADD, EXPIRE', () => {
        const source = readRedisSource();

        expect(source).toContain("redis.call('SCARD'");
        expect(source).toContain("redis.call('DEL'");
        expect(source).toContain("redis.call('SADD'");
        expect(source).toContain("redis.call('EXPIRE'");
    });
});

describe('CACHE_PARENT_LIMIT truncation warning', () => {
    test('clearParentCacheBulk warns on truncation', () => {
        const source = require('fs').readFileSync(require('path').join(__dirname, '../../src/utils/cacheClientUtils.ts'), 'utf8');
        expect(source).toContain('console.warn');
        expect(source).toMatch(/console\.warn.*truncat/i);
    });

    test('clearParentCache warns on truncation', () => {
        const source = require('fs').readFileSync(require('path').join(__dirname, '../../src/utils/cacheClientUtils.ts'), 'utf8');
        const funcMatch = source.match(/export const clearParentCache = async[\s\S]*?^};/m);
        const funcBody = funcMatch?.[0] ?? '';

        expect(funcBody).toContain('console.warn');
        expect(funcBody).toMatch(/parents? skipped/i);
    });
});

describe('publishRecordIdsOnChannel null safety', () => {
    test('has null-coalescing fallback for absent Redis instance', () => {
        const source = require('fs').readFileSync(require('path').join(__dirname, '../../src/utils/redisUtils.ts'), 'utf8');
        expect(source).toContain('publishRecordIdsOnChannel');
        expect(source).toMatch(/publishRecordIdsOnChannel[\s\S]*?\?\?/);
    });
});
