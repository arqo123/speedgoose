import Redis from 'ioredis';
import { RedisStrategy } from '../../src/cachingStrategies/redisStrategy';

/**
 * Tests for invalidation set TTL and cardinality limits (issue #168).
 *
 * Covers:
 * - addValueToCacheSet: TTL, cardinality guard, edge cases
 * - addValueToManyCachedSets: TTL per namespace, cardinality guard, mixed sizes
 * - addParentToChildRelationship: TTL, cardinality guard
 * - addManyParentToChildRelationships: TTL per unique child, cardinality guard, dedup
 * - clearResultsCacheWithSet: batched DEL for large sets
 */

const strategy = new RedisStrategy();
strategy.client = new Redis();

const mockedRedisDelMethod = jest.spyOn(strategy.client, 'del');
const mockedRedisPipelineMethod = jest.spyOn(strategy.client, 'pipeline');

beforeEach(() => {
    jest.clearAllMocks();
});

// ────────────────────────────────────────────
// addValueToCacheSet
// ────────────────────────────────────────────

describe('addValueToCacheSet — TTL behavior', () => {
    test('should pass TTL as 0 when setsTtl is 0', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(1);

        await strategy.addValueToCacheSet('ns', 'val', 0);

        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SADD'), 1, 'ns', 'val', '0', '0');
        mockedEval.mockRestore();
    });

    test('should pass TTL as 0 when setsTtl is undefined', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(1);

        await strategy.addValueToCacheSet('ns', 'val', undefined);

        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SADD'), 1, 'ns', 'val', '0', '0');
        mockedEval.mockRestore();
    });

    test('should pass correct TTL value in eval', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(1);

        await strategy.addValueToCacheSet('mySet', 'myVal', 300);

        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SADD'), 1, 'mySet', 'myVal', '0', '300');
        mockedEval.mockRestore();
    });

    test('should execute as a single atomic eval call', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(1);

        await strategy.addValueToCacheSet('ns', 'v', 60);

        // Single atomic eval — no pipeline needed
        expect(mockedEval).toHaveBeenCalledTimes(1);
        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('EXPIRE'), 1, 'ns', 'v', '0', '60');
        mockedEval.mockRestore();
    });
});

describe('addValueToCacheSet — cardinality guard', () => {
    test('should pass maxSetCardinality as 0 when disabled', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(1);

        await strategy.addValueToCacheSet('ns', 'val', 0, 0);

        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SADD'), 1, 'ns', 'val', '0', '0');
        // Lua script handles the maxCard == 0 check internally
        mockedEval.mockRestore();
    });

    test('should pass maxSetCardinality as 0 when undefined', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(1);

        await strategy.addValueToCacheSet('ns', 'val', 0, undefined);

        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SADD'), 1, 'ns', 'val', '0', '0');
        mockedEval.mockRestore();
    });

    test('should pass cardinality limit to Lua script for enforcement', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(1);

        await strategy.addValueToCacheSet('ns', 'val', 0, 100);

        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SCARD'), 1, 'ns', 'val', '100', '0');
        mockedEval.mockRestore();
    });

    test('should use Lua script that contains SCARD and DEL for cardinality enforcement', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(1);

        await strategy.addValueToCacheSet('ns', 'val', 0, 100);

        const luaScript = mockedEval.mock.calls[0][0] as string;
        expect(luaScript).toContain('SCARD');
        expect(luaScript).toContain('DEL');
        expect(luaScript).toContain('SADD');
        mockedEval.mockRestore();
    });

    test('should pass both value and cardinality limit atomically', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(1);

        await strategy.addValueToCacheSet('ns', 'val', 60, 100);

        // All parameters passed in one atomic eval call
        expect(mockedEval).toHaveBeenCalledTimes(1);
        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SADD'), 1, 'ns', 'val', '100', '60');
        mockedEval.mockRestore();
    });
});

// ────────────────────────────────────────────
// addValueToManyCachedSets
// ────────────────────────────────────────────

describe('addValueToManyCachedSets — TTL behavior', () => {
    test('should pass TTL for each namespace via Lua script', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(3);

        await strategy.addValueToManyCachedSets(['a', 'b', 'c'], 'val', 90);

        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('EXPIRE'), 3, 'a', 'b', 'c', 'val', '0', '90');
        mockedEval.mockRestore();
    });

    test('should pass TTL as 0 when setsTtl is 0', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(2);

        await strategy.addValueToManyCachedSets(['a', 'b'], 'val', 0);

        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SADD'), 2, 'a', 'b', 'val', '0', '0');
        mockedEval.mockRestore();
    });

    test('should handle empty namespaces array', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(0);

        await strategy.addValueToManyCachedSets([], 'val', 60);

        expect(mockedEval).not.toHaveBeenCalled();
        mockedEval.mockRestore();
    });
});

describe('addValueToManyCachedSets — cardinality guard', () => {
    test('should pass cardinality limit to Lua script for atomic enforcement', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(2);

        await strategy.addValueToManyCachedSets(['ns1', 'ns2'], 'val', 0, 100);

        // Cardinality check is done atomically inside Lua
        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SCARD'), 2, 'ns1', 'ns2', 'val', '100', '0');
        mockedEval.mockRestore();
    });

    test('should pass maxSetCardinality as 0 when disabled', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(2);

        await strategy.addValueToManyCachedSets(['ns1', 'ns2'], 'val', 0, 0);

        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SADD'), 2, 'ns1', 'ns2', 'val', '0', '0');
        mockedEval.mockRestore();
    });

    test('should use a single atomic eval for all namespaces', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(3);

        await strategy.addValueToManyCachedSets(['a', 'b', 'c'], 'val', 0, 100);

        // Single eval call handles all keys atomically
        expect(mockedEval).toHaveBeenCalledTimes(1);
        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SCARD'), 3, 'a', 'b', 'c', 'val', '100', '0');
        mockedEval.mockRestore();
    });
});

// ────────────────────────────────────────────
// addParentToChildRelationship
// ────────────────────────────────────────────

describe('addParentToChildRelationship — TTL behavior', () => {
    test('should pass TTL to Lua script for atomic expire', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(1);

        await strategy.addParentToChildRelationship('rel:child:User:123', 'Post:456', 180);

        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SADD'), 1, 'rel:child:User:123', 'Post:456', '0', '180');
        mockedEval.mockRestore();
    });

    test('should pass TTL as 0 when setsTtl is 0', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(1);

        await strategy.addParentToChildRelationship('rel:child:User:123', 'Post:456', 0);

        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SADD'), 1, 'rel:child:User:123', 'Post:456', '0', '0');
        mockedEval.mockRestore();
    });
});

describe('addParentToChildRelationship — cardinality guard', () => {
    test('should pass cardinality limit to Lua script for atomic enforcement', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(1);

        await strategy.addParentToChildRelationship('rel:child:User:123', 'Post:456', 60, 100);

        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SCARD'), 1, 'rel:child:User:123', 'Post:456', '100', '60');
        mockedEval.mockRestore();
    });
});

// ────────────────────────────────────────────
// addManyParentToChildRelationships
// ────────────────────────────────────────────

describe('addManyParentToChildRelationships — TTL behavior', () => {
    test('should call eval per unique child with TTL', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(1);

        await strategy.addManyParentToChildRelationships(
            [
                { childIdentifier: 'child:1', parentIdentifier: 'parent:a' },
                { childIdentifier: 'child:2', parentIdentifier: 'parent:b' },
                { childIdentifier: 'child:1', parentIdentifier: 'parent:c' }, // duplicate child
            ],
            240,
        );

        // 2 unique children → 2 eval calls
        expect(mockedEval).toHaveBeenCalledTimes(2);
        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SADD'), 1, 'child:1', '0', '240', 'parent:a', 'parent:c');
        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SADD'), 1, 'child:2', '0', '240', 'parent:b');
        mockedEval.mockRestore();
    });

    test('should pass TTL as 0 when setsTtl is 0', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(1);

        await strategy.addManyParentToChildRelationships([{ childIdentifier: 'child:1', parentIdentifier: 'parent:a' }], 0);

        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SADD'), 1, 'child:1', '0', '0', 'parent:a');
        mockedEval.mockRestore();
    });

    test('should handle single relationship', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(1);

        await strategy.addManyParentToChildRelationships([{ childIdentifier: 'child:1', parentIdentifier: 'parent:a' }], 60);

        expect(mockedEval).toHaveBeenCalledTimes(1);
        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SADD'), 1, 'child:1', '0', '60', 'parent:a');
        mockedEval.mockRestore();
    });
});

describe('addManyParentToChildRelationships — cardinality guard', () => {
    test('should pass cardinality limit to Lua script per unique child', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(1);

        await strategy.addManyParentToChildRelationships(
            [
                { childIdentifier: 'child:1', parentIdentifier: 'parent:a' },
                { childIdentifier: 'child:2', parentIdentifier: 'parent:b' },
            ],
            0,
            100,
        );

        expect(mockedEval).toHaveBeenCalledTimes(2);
        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SCARD'), 1, 'child:1', '100', '0', 'parent:a');
        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SCARD'), 1, 'child:2', '100', '0', 'parent:b');
        mockedEval.mockRestore();
    });

    test('should skip eval for empty relationships', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(1);

        await strategy.addManyParentToChildRelationships([], 60, 100);

        expect(mockedEval).not.toHaveBeenCalled();
        mockedEval.mockRestore();
    });
});

// ────────────────────────────────────────────
// clearResultsCacheWithSet — batched DEL
// ────────────────────────────────────────────

describe('clearResultsCacheWithSet — batched deletion', () => {
    test('should delete in batches of 500 for large sets', async () => {
        // Generate 1200 keys to trigger 3 batches (500 + 500 + 200)
        const keys = Array.from({ length: 1200 }, (_, i) => `key${i}`);
        jest.spyOn(strategy, 'getValuesFromCachedSet').mockResolvedValue(keys);

        await strategy.clearResultsCacheWithSet('bigNamespace');

        // 3 batches of DEL + 1 DEL for the set itself = 4 del calls
        expect(mockedRedisDelMethod).toHaveBeenCalledTimes(4);

        // Verify first batch has 500 keys
        const firstBatchArgs = mockedRedisDelMethod.mock.calls[0];
        expect(firstBatchArgs.length).toBe(500);

        // Verify second batch has 500 keys
        const secondBatchArgs = mockedRedisDelMethod.mock.calls[1];
        expect(secondBatchArgs.length).toBe(500);

        // Verify third batch has 200 keys
        const thirdBatchArgs = mockedRedisDelMethod.mock.calls[2];
        expect(thirdBatchArgs.length).toBe(200);

        // Verify last call deletes the set itself
        expect(mockedRedisDelMethod).toHaveBeenLastCalledWith('bigNamespace');
    });

    test('should handle sets smaller than batch size', async () => {
        const keys = ['k1', 'k2', 'k3'];
        jest.spyOn(strategy, 'getValuesFromCachedSet').mockResolvedValue(keys);

        await strategy.clearResultsCacheWithSet('smallNamespace');

        // 1 batch DEL + 1 set DEL = 2 calls
        expect(mockedRedisDelMethod).toHaveBeenCalledTimes(2);
    });

    test('should handle exactly 500 keys (1 full batch)', async () => {
        const keys = Array.from({ length: 500 }, (_, i) => `key${i}`);
        jest.spyOn(strategy, 'getValuesFromCachedSet').mockResolvedValue(keys);

        await strategy.clearResultsCacheWithSet('ns');

        // 1 batch + 1 set cleanup
        expect(mockedRedisDelMethod).toHaveBeenCalledTimes(2);
        expect(mockedRedisDelMethod.mock.calls[0].length).toBe(500);
    });

    test('should handle empty set gracefully', async () => {
        jest.spyOn(strategy, 'getValuesFromCachedSet').mockResolvedValue([]);

        await strategy.clearResultsCacheWithSet('emptyNs');

        expect(mockedRedisDelMethod).not.toHaveBeenCalled();
    });
});

// ────────────────────────────────────────────
// Combined TTL + cardinality
// ────────────────────────────────────────────

describe('combined TTL and cardinality', () => {
    test('addValueToCacheSet should pass both TTL and cardinality to atomic Lua script', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(1);

        await strategy.addValueToCacheSet('ns', 'val', 120, 100);

        // Both cardinality and TTL handled atomically in a single eval
        expect(mockedEval).toHaveBeenCalledTimes(1);
        const luaScript = mockedEval.mock.calls[0][0] as string;
        expect(luaScript).toContain('SCARD');
        expect(luaScript).toContain('DEL');
        expect(luaScript).toContain('SADD');
        expect(luaScript).toContain('EXPIRE');
        expect(mockedEval).toHaveBeenCalledWith(expect.any(String), 1, 'ns', 'val', '100', '120');
        mockedEval.mockRestore();
    });

    test('addValueToCacheSet with negative TTL should pass negative TTL to Lua (handled by ttl > 0 check)', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(1);

        await strategy.addValueToCacheSet('ns', 'val', -1);

        // TTL passed as '-1', Lua script's `if ttl > 0` will skip EXPIRE
        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SADD'), 1, 'ns', 'val', '0', '-1');
        mockedEval.mockRestore();
    });
});
