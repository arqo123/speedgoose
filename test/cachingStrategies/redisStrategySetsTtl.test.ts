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
    test('should NOT call expire when setsTtl is 0', async () => {
        const pipeline = strategy.client.pipeline();
        mockedRedisPipelineMethod.mockReturnValue(pipeline);
        const expireSpy = jest.spyOn(pipeline, 'expire');

        await strategy.addValueToCacheSet('ns', 'val', 0);

        expect(expireSpy).not.toHaveBeenCalled();
    });

    test('should NOT call expire when setsTtl is undefined', async () => {
        const pipeline = strategy.client.pipeline();
        mockedRedisPipelineMethod.mockReturnValue(pipeline);
        const expireSpy = jest.spyOn(pipeline, 'expire');

        await strategy.addValueToCacheSet('ns', 'val', undefined);

        expect(expireSpy).not.toHaveBeenCalled();
    });

    test('should call expire with correct TTL value', async () => {
        const pipeline = strategy.client.pipeline();
        mockedRedisPipelineMethod.mockReturnValue(pipeline);
        const saddSpy = jest.spyOn(pipeline, 'sadd');
        const expireSpy = jest.spyOn(pipeline, 'expire');
        const execSpy = jest.spyOn(pipeline, 'exec');

        await strategy.addValueToCacheSet('mySet', 'myVal', 300);

        expect(saddSpy).toHaveBeenCalledWith('mySet', 'myVal');
        expect(expireSpy).toHaveBeenCalledWith('mySet', 300);
        expect(execSpy).toHaveBeenCalledTimes(1);
    });

    test('should call both sadd and expire in a single pipeline', async () => {
        const pipeline = strategy.client.pipeline();
        mockedRedisPipelineMethod.mockReturnValue(pipeline).mockClear();
        const saddSpy = jest.spyOn(pipeline, 'sadd').mockClear();
        const expireSpy = jest.spyOn(pipeline, 'expire').mockClear();
        const execSpy = jest.spyOn(pipeline, 'exec').mockClear();

        await strategy.addValueToCacheSet('ns', 'v', 60);

        // Only 1 pipeline created, 1 exec
        expect(mockedRedisPipelineMethod).toHaveBeenCalledTimes(1);
        expect(saddSpy).toHaveBeenCalledTimes(1);
        expect(expireSpy).toHaveBeenCalledTimes(1);
        expect(execSpy).toHaveBeenCalledTimes(1);
    });
});

describe('addValueToCacheSet — cardinality guard', () => {
    test('should NOT check scard when maxSetCardinality is 0 (disabled)', async () => {
        const scardSpy = jest.spyOn(strategy.client, 'scard');
        const pipeline = strategy.client.pipeline();
        mockedRedisPipelineMethod.mockReturnValue(pipeline);

        await strategy.addValueToCacheSet('ns', 'val', 0, 0);

        expect(scardSpy).not.toHaveBeenCalled();
        scardSpy.mockRestore();
    });

    test('should NOT check scard when maxSetCardinality is undefined', async () => {
        const scardSpy = jest.spyOn(strategy.client, 'scard');
        const pipeline = strategy.client.pipeline();
        mockedRedisPipelineMethod.mockReturnValue(pipeline);

        await strategy.addValueToCacheSet('ns', 'val', 0, undefined);

        expect(scardSpy).not.toHaveBeenCalled();
        scardSpy.mockRestore();
    });

    test('should NOT delete set when cardinality is below limit', async () => {
        const scardSpy = jest.spyOn(strategy.client, 'scard').mockResolvedValue(50);
        const pipeline = strategy.client.pipeline();
        mockedRedisPipelineMethod.mockReturnValue(pipeline);

        await strategy.addValueToCacheSet('ns', 'val', 0, 100);

        expect(scardSpy).toHaveBeenCalledWith('ns');
        expect(mockedRedisDelMethod).not.toHaveBeenCalled();
        scardSpy.mockRestore();
    });

    test('should delete set when cardinality equals limit', async () => {
        const scardSpy = jest.spyOn(strategy.client, 'scard').mockResolvedValue(100);
        const pipeline = strategy.client.pipeline();
        mockedRedisPipelineMethod.mockReturnValue(pipeline);

        await strategy.addValueToCacheSet('ns', 'val', 0, 100);

        expect(mockedRedisDelMethod).toHaveBeenCalledWith('ns');
        scardSpy.mockRestore();
    });

    test('should delete set when cardinality exceeds limit', async () => {
        const scardSpy = jest.spyOn(strategy.client, 'scard').mockResolvedValue(200);
        const pipeline = strategy.client.pipeline();
        mockedRedisPipelineMethod.mockReturnValue(pipeline);

        await strategy.addValueToCacheSet('ns', 'val', 0, 100);

        expect(mockedRedisDelMethod).toHaveBeenCalledWith('ns');
        scardSpy.mockRestore();
    });

    test('should still add the value after resetting the set', async () => {
        const scardSpy = jest.spyOn(strategy.client, 'scard').mockResolvedValue(500);
        const pipeline = strategy.client.pipeline();
        mockedRedisPipelineMethod.mockReturnValue(pipeline);
        const saddSpy = jest.spyOn(pipeline, 'sadd');

        await strategy.addValueToCacheSet('ns', 'val', 60, 100);

        expect(mockedRedisDelMethod).toHaveBeenCalledWith('ns');
        expect(saddSpy).toHaveBeenCalledWith('ns', 'val');
        scardSpy.mockRestore();
    });
});

// ────────────────────────────────────────────
// addValueToManyCachedSets
// ────────────────────────────────────────────

describe('addValueToManyCachedSets — TTL behavior', () => {
    test('should set expire for each namespace when setsTtl provided', async () => {
        const pipeline = strategy.client.pipeline();
        mockedRedisPipelineMethod.mockReturnValue(pipeline);
        const saddSpy = jest.spyOn(pipeline, 'sadd');
        const expireSpy = jest.spyOn(pipeline, 'expire');

        await strategy.addValueToManyCachedSets(['a', 'b', 'c'], 'val', 90);

        expect(saddSpy).toHaveBeenCalledTimes(3);
        expect(expireSpy).toHaveBeenCalledTimes(3);
        expect(expireSpy).toHaveBeenCalledWith('a', 90);
        expect(expireSpy).toHaveBeenCalledWith('b', 90);
        expect(expireSpy).toHaveBeenCalledWith('c', 90);
    });

    test('should NOT expire when setsTtl is 0', async () => {
        const pipeline = strategy.client.pipeline();
        mockedRedisPipelineMethod.mockReturnValue(pipeline);
        const expireSpy = jest.spyOn(pipeline, 'expire');

        await strategy.addValueToManyCachedSets(['a', 'b'], 'val', 0);

        expect(expireSpy).not.toHaveBeenCalled();
    });

    test('should handle empty namespaces array', async () => {
        const pipeline = strategy.client.pipeline();
        mockedRedisPipelineMethod.mockReturnValue(pipeline);
        const saddSpy = jest.spyOn(pipeline, 'sadd');

        await strategy.addValueToManyCachedSets([], 'val', 60);

        expect(saddSpy).not.toHaveBeenCalled();
    });
});

describe('addValueToManyCachedSets — cardinality guard', () => {
    test('should reset only oversized sets', async () => {
        // ns1 has 50 members (under limit), ns2 has 200 (over limit)
        const scardPipeline = strategy.client.pipeline();
        const mainPipeline = strategy.client.pipeline();
        let pipelineCall = 0;
        mockedRedisPipelineMethod.mockImplementation(() => {
            pipelineCall++;
            // First pipeline call is for scard checks, subsequent for sadd
            return pipelineCall === 1 ? scardPipeline : mainPipeline;
        });

        jest.spyOn(scardPipeline, 'scard');
        jest.spyOn(scardPipeline, 'exec').mockResolvedValue([
            [null, 50], // ns1 — under limit
            [null, 200], // ns2 — over limit
        ]);

        await strategy.addValueToManyCachedSets(['ns1', 'ns2'], 'val', 0, 100);

        // Only ns2 should be deleted
        expect(mockedRedisDelMethod).toHaveBeenCalledTimes(1);
        expect(mockedRedisDelMethod).toHaveBeenCalledWith('ns2');
    });

    test('should NOT check cardinality when maxSetCardinality is 0', async () => {
        const pipeline = strategy.client.pipeline();
        mockedRedisPipelineMethod.mockReturnValue(pipeline);
        const scardSpy = jest.spyOn(pipeline, 'scard');

        await strategy.addValueToManyCachedSets(['ns1', 'ns2'], 'val', 0, 0);

        expect(scardSpy).not.toHaveBeenCalled();
    });

    test('should reset all oversized sets when all exceed limit', async () => {
        const scardPipeline = strategy.client.pipeline();
        const mainPipeline = strategy.client.pipeline();
        let pipelineCall = 0;
        mockedRedisPipelineMethod.mockImplementation(() => {
            pipelineCall++;
            return pipelineCall === 1 ? scardPipeline : mainPipeline;
        });

        jest.spyOn(scardPipeline, 'scard');
        jest.spyOn(scardPipeline, 'exec').mockResolvedValue([
            [null, 500],
            [null, 300],
            [null, 150],
        ]);

        await strategy.addValueToManyCachedSets(['a', 'b', 'c'], 'val', 0, 100);

        expect(mockedRedisDelMethod).toHaveBeenCalledWith('a', 'b', 'c');
    });
});

// ────────────────────────────────────────────
// addParentToChildRelationship
// ────────────────────────────────────────────

describe('addParentToChildRelationship — TTL behavior', () => {
    test('should set expire on parent-child relationship set', async () => {
        const pipeline = strategy.client.pipeline();
        mockedRedisPipelineMethod.mockReturnValue(pipeline);
        const saddSpy = jest.spyOn(pipeline, 'sadd');
        const expireSpy = jest.spyOn(pipeline, 'expire');

        await strategy.addParentToChildRelationship('rel:child:User:123', 'Post:456', 180);

        expect(saddSpy).toHaveBeenCalledWith('rel:child:User:123', 'Post:456');
        expect(expireSpy).toHaveBeenCalledWith('rel:child:User:123', 180);
    });

    test('should NOT set expire when setsTtl is 0', async () => {
        const pipeline = strategy.client.pipeline();
        mockedRedisPipelineMethod.mockReturnValue(pipeline);
        const expireSpy = jest.spyOn(pipeline, 'expire');

        await strategy.addParentToChildRelationship('rel:child:User:123', 'Post:456', 0);

        expect(expireSpy).not.toHaveBeenCalled();
    });
});

describe('addParentToChildRelationship — cardinality guard', () => {
    test('should reset relationship set when exceeding cardinality', async () => {
        const scardSpy = jest.spyOn(strategy.client, 'scard').mockResolvedValue(500);
        const pipeline = strategy.client.pipeline();
        mockedRedisPipelineMethod.mockReturnValue(pipeline);

        await strategy.addParentToChildRelationship('rel:child:User:123', 'Post:456', 60, 100);

        expect(scardSpy).toHaveBeenCalledWith('rel:child:User:123');
        expect(mockedRedisDelMethod).toHaveBeenCalledWith('rel:child:User:123');
        scardSpy.mockRestore();
    });
});

// ────────────────────────────────────────────
// addManyParentToChildRelationships
// ────────────────────────────────────────────

describe('addManyParentToChildRelationships — TTL behavior', () => {
    test('should set expire for each unique child identifier', async () => {
        const pipeline = strategy.client.pipeline();
        mockedRedisPipelineMethod.mockReturnValue(pipeline);
        const saddSpy = jest.spyOn(pipeline, 'sadd');
        const expireSpy = jest.spyOn(pipeline, 'expire');

        await strategy.addManyParentToChildRelationships(
            [
                { childIdentifier: 'child:1', parentIdentifier: 'parent:a' },
                { childIdentifier: 'child:2', parentIdentifier: 'parent:b' },
                { childIdentifier: 'child:1', parentIdentifier: 'parent:c' }, // duplicate child
            ],
            240,
        );

        expect(saddSpy).toHaveBeenCalledTimes(3);
        // Only 2 unique children → 2 expire calls
        expect(expireSpy).toHaveBeenCalledTimes(2);
        expect(expireSpy).toHaveBeenCalledWith('child:1', 240);
        expect(expireSpy).toHaveBeenCalledWith('child:2', 240);
    });

    test('should NOT set expire when setsTtl is 0', async () => {
        const pipeline = strategy.client.pipeline();
        mockedRedisPipelineMethod.mockReturnValue(pipeline);
        const expireSpy = jest.spyOn(pipeline, 'expire');

        await strategy.addManyParentToChildRelationships([{ childIdentifier: 'child:1', parentIdentifier: 'parent:a' }], 0);

        expect(expireSpy).not.toHaveBeenCalled();
    });

    test('should handle single relationship', async () => {
        const pipeline = strategy.client.pipeline();
        mockedRedisPipelineMethod.mockReturnValue(pipeline);
        const saddSpy = jest.spyOn(pipeline, 'sadd');
        const expireSpy = jest.spyOn(pipeline, 'expire');

        await strategy.addManyParentToChildRelationships([{ childIdentifier: 'child:1', parentIdentifier: 'parent:a' }], 60);

        expect(saddSpy).toHaveBeenCalledTimes(1);
        expect(expireSpy).toHaveBeenCalledTimes(1);
    });
});

describe('addManyParentToChildRelationships — cardinality guard', () => {
    test('should reset only oversized child sets', async () => {
        const scardPipeline = strategy.client.pipeline();
        const mainPipeline = strategy.client.pipeline();
        let pipelineCall = 0;
        mockedRedisPipelineMethod.mockImplementation(() => {
            pipelineCall++;
            return pipelineCall === 1 ? scardPipeline : mainPipeline;
        });

        jest.spyOn(scardPipeline, 'scard');
        jest.spyOn(scardPipeline, 'exec').mockResolvedValue([
            [null, 50], // child:1 — under limit
            [null, 200], // child:2 — over limit
        ]);

        await strategy.addManyParentToChildRelationships(
            [
                { childIdentifier: 'child:1', parentIdentifier: 'parent:a' },
                { childIdentifier: 'child:2', parentIdentifier: 'parent:b' },
            ],
            0,
            100,
        );

        expect(mockedRedisDelMethod).toHaveBeenCalledTimes(1);
        expect(mockedRedisDelMethod).toHaveBeenCalledWith('child:2');
    });

    test('should skip cardinality check for empty relationships', async () => {
        await strategy.addManyParentToChildRelationships([], 60, 100);
        expect(mockedRedisPipelineMethod).not.toHaveBeenCalled();
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
    test('addValueToCacheSet should apply both TTL and cardinality check', async () => {
        const scardSpy = jest.spyOn(strategy.client, 'scard').mockResolvedValue(200);
        const pipeline = strategy.client.pipeline();
        mockedRedisPipelineMethod.mockReturnValue(pipeline);
        const saddSpy = jest.spyOn(pipeline, 'sadd');
        const expireSpy = jest.spyOn(pipeline, 'expire');

        await strategy.addValueToCacheSet('ns', 'val', 120, 100);

        // Cardinality exceeded → del
        expect(mockedRedisDelMethod).toHaveBeenCalledWith('ns');
        // Then sadd + expire
        expect(saddSpy).toHaveBeenCalledWith('ns', 'val');
        expect(expireSpy).toHaveBeenCalledWith('ns', 120);

        scardSpy.mockRestore();
    });

    test('addValueToCacheSet with negative TTL should not expire', async () => {
        const pipeline = strategy.client.pipeline();
        mockedRedisPipelineMethod.mockReturnValue(pipeline);
        const expireSpy = jest.spyOn(pipeline, 'expire');

        await strategy.addValueToCacheSet('ns', 'val', -1);

        expect(expireSpy).not.toHaveBeenCalled();
    });
});
