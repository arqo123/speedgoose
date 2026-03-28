import Redis from 'ioredis';
import { RedisStrategy } from '../../src/cachingStrategies/redisStrategy';
import { CacheNamespaces } from '../../src/types/types';

const strategy = new RedisStrategy();
strategy.client = new Redis();

const mockedRedisDelMethod = jest.spyOn(strategy.client, 'del');
const mockedRedisSaddMethod = jest.spyOn(strategy.client, 'sadd');
const mockedRedisGetMethod = jest.spyOn(strategy.client, 'get');
const mockedRedisSmembersMethod = jest.spyOn(strategy.client, 'smembers');
const mockedRedisPipelineMethod = jest.spyOn(strategy.client, 'pipeline');

beforeEach(() => {
    mockedRedisDelMethod.mockClear();
    mockedRedisGetMethod.mockClear();
    mockedRedisSmembersMethod.mockClear();
    mockedRedisSaddMethod.mockClear();
    mockedRedisPipelineMethod.mockClear();
});

describe('RedisStrategy.isHydrationEnabled', () => {
    test(`should return true`, () => {
        expect(strategy.isHydrationEnabled()).toBeTruthy();
    });
});

describe('RedisStrategy.removeKeyForCache', () => {
    test(`should call del method on redis client with correct namespace and key`, () => {
        strategy.removeKeyForCache('someNamespace', 'someKey');
        expect(mockedRedisDelMethod).toHaveBeenCalledTimes(1);
        expect(mockedRedisDelMethod).toHaveBeenCalledWith('someNamespace:someKey');
    });
});

describe('RedisStrategy.addValueToCacheSet', () => {
    test(`should call eval with Lua script, correct key and value`, async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(1);

        await strategy.addValueToCacheSet('someNamespace', 'someValue');

        expect(mockedEval).toHaveBeenCalledTimes(1);
        expect(mockedEval).toHaveBeenCalledWith(
            expect.stringContaining('SADD'),
            1,
            'someNamespace',
            'someValue',
            '0', // maxSetCardinality defaults to 0
            '0', // setsTtl defaults to 0
        );

        mockedEval.mockRestore();
    });

    test(`should pass TTL when setsTtl is provided`, async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(1);

        await strategy.addValueToCacheSet('someNamespace', 'someValue', 120);

        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SADD'), 1, 'someNamespace', 'someValue', '0', '120');

        mockedEval.mockRestore();
    });

    test(`should pass maxSetCardinality when provided`, async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(1);

        await strategy.addValueToCacheSet('someNamespace', 'someValue', 0, 50);

        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SCARD'), 1, 'someNamespace', 'someValue', '50', '0');

        mockedEval.mockRestore();
    });
});

describe('RedisStrategy.addValueToCache', () => {
    test(`should call sadd method on redis client with correct namespace and value with use of pipeline`, () => {
        const pipeline = strategy.client.pipeline();
        mockedRedisPipelineMethod.mockReturnValue(pipeline).mockClear();

        const mockedRedisPipelineSetMethod = jest.spyOn(pipeline, 'set').mockClear();
        const mockedRedisPipelineExecMethod = jest.spyOn(pipeline, 'exec').mockClear();
        const mockedRedisPipelineExpireMethod = jest.spyOn(pipeline, 'expire').mockClear();

        strategy.addValueToCache('someNamespace', 'someKey', { testKey: 'testValue' }, 123);

        expect(mockedRedisPipelineMethod).toHaveBeenCalledTimes(1);

        expect(mockedRedisPipelineSetMethod).toHaveBeenCalledTimes(1);
        expect(mockedRedisPipelineSetMethod).toHaveBeenCalledWith('someNamespace:someKey', '{"testKey":"testValue"}');

        expect(mockedRedisPipelineExpireMethod).toHaveBeenCalledTimes(1);
        expect(mockedRedisPipelineExpireMethod).toHaveBeenCalledWith('someNamespace:someKey', 123);

        expect(mockedRedisPipelineExecMethod).toHaveBeenCalledTimes(1);
    });
});

describe('RedisStrategy.getValueFromCache', () => {
    test(`should call sadd method on redis client with correct namespace and value with use of pipeline`, () => {
        strategy.getValueFromCache('someNamespace', 'someKey');
        expect(mockedRedisGetMethod).toHaveBeenCalledTimes(1);
        expect(mockedRedisGetMethod).toHaveBeenCalledWith('someNamespace:someKey');
    });

    test(`should return null if there was no value assigned to test key`, async () => {
        mockedRedisGetMethod.mockImplementation(async () => null);
        const result = await strategy.getValueFromCache('someNamespace', 'someKey');
        expect(result).toEqual(null);
    });

    test(`should return value parsed from JSON`, async () => {
        mockedRedisGetMethod.mockImplementation(async () => '{"someKey":"testValue"}');
        const result = await strategy.getValueFromCache('someNamespace', 'someKey');

        expect(result).toEqual({ someKey: 'testValue' });
    });
});

describe('RedisStrategy.getValuesFromCachedSet', () => {
    test(`should call smembers method on redis client`, async () => {
        await strategy.getValuesFromCachedSet('someNamespace');
        expect(mockedRedisSmembersMethod).toHaveBeenCalledTimes(1);
        expect(mockedRedisSmembersMethod).toHaveBeenCalledWith('someNamespace');
    });

    test(`should return value returned by the smembers method`, async () => {
        mockedRedisSmembersMethod.mockImplementation(async () => ['someValue']);
        const result = await strategy.getValuesFromCachedSet('someNamespace');

        expect(result).toEqual(['someValue']);
    });
});

describe('RedisStrategy.addValueToManyCachedSets', () => {
    test(`should call eval with Lua script for all namespaces`, async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(3);

        await strategy.addValueToManyCachedSets(['nameSpace1', 'nameSpace2', 'nameSpace3'], 'someValue');

        expect(mockedEval).toHaveBeenCalledTimes(1);
        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SADD'), 3, 'nameSpace1', 'nameSpace2', 'nameSpace3', 'someValue', '0', '0');

        mockedEval.mockRestore();
    });

    test(`should pass TTL when setsTtl is provided`, async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(2);

        await strategy.addValueToManyCachedSets(['ns1', 'ns2'], 'val', 60);

        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SADD'), 2, 'ns1', 'ns2', 'val', '0', '60');

        mockedEval.mockRestore();
    });

    test(`should not call eval for empty namespaces array`, async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(0);

        await strategy.addValueToManyCachedSets([], 'val', 60);

        expect(mockedEval).not.toHaveBeenCalled();

        mockedEval.mockRestore();
    });
});

describe('RedisStrategy.clearResultsCacheWithSet', () => {
    test(`should call del method on redis with the values assigned to given namespace`, async () => {
        const mockedGetValuesFromCachedSet = jest.spyOn(strategy, 'getValuesFromCachedSet').mockClear();
        mockedGetValuesFromCachedSet.mockImplementation(async () => ['someKey1', 'someKey2', 'someKey3']);
        const cachedSetsPreparedKeys = ['someKey1', 'someKey2', 'someKey3'].map(key => `${CacheNamespaces.RESULTS_NAMESPACE}:${key}`);

        await strategy.clearResultsCacheWithSet('someNamespace');
        expect(mockedRedisDelMethod).toHaveBeenCalledTimes(2);
        expect(mockedRedisDelMethod).toHaveBeenCalledWith(...cachedSetsPreparedKeys);
        expect(mockedRedisDelMethod).toHaveBeenCalledWith('someNamespace');
    });
});

describe('RedisStrategy.refreshTTLForCachedResult', () => {
    test(`should call expire for given key`, async () => {
        const testData = { key: 'key1', ttl: 0.2 };
        const mockedExpire = jest.spyOn(strategy.client, 'expire');

        await strategy.refreshTTLForCachedResult(testData.key, testData.ttl);
        expect(mockedExpire).toHaveBeenCalledWith(`${CacheNamespaces.RESULTS_NAMESPACE}:${testData.key}`, testData.ttl);
    });
});

describe('RedisStrategy.addManyParentToChildRelationships', () => {
    test('should call eval with Lua script per unique child', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(1);

        await strategy.addManyParentToChildRelationships([
            { childIdentifier: 'rel:child:Model:id1', parentIdentifier: 'Parent:p1' },
            { childIdentifier: 'rel:child:Model:id2', parentIdentifier: 'Parent:p2' },
            { childIdentifier: 'rel:child:Model:id1', parentIdentifier: 'Parent:p3' },
        ]);

        // 2 unique children → 2 eval calls
        expect(mockedEval).toHaveBeenCalledTimes(2);

        // Child id1 with parents p1 and p3
        expect(mockedEval).toHaveBeenCalledWith(
            expect.stringContaining('SADD'),
            1,
            'rel:child:Model:id1',
            '0', // maxSetCardinality
            '0', // setsTtl
            'Parent:p1',
            'Parent:p3',
        );

        // Child id2 with parent p2
        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SADD'), 1, 'rel:child:Model:id2', '0', '0', 'Parent:p2');

        mockedEval.mockRestore();
    });

    test('should pass TTL when setsTtl is provided', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(1);

        await strategy.addManyParentToChildRelationships(
            [
                { childIdentifier: 'rel:child:Model:id1', parentIdentifier: 'Parent:p1' },
                { childIdentifier: 'rel:child:Model:id2', parentIdentifier: 'Parent:p2' },
                { childIdentifier: 'rel:child:Model:id1', parentIdentifier: 'Parent:p3' },
            ],
            120,
        );

        // 2 unique children → 2 eval calls, each with ttl '120'
        expect(mockedEval).toHaveBeenCalledTimes(2);
        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SADD'), 1, 'rel:child:Model:id1', '0', '120', 'Parent:p1', 'Parent:p3');
        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SADD'), 1, 'rel:child:Model:id2', '0', '120', 'Parent:p2');

        mockedEval.mockRestore();
    });

    test('should not call eval for empty relationships array', async () => {
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(1);

        await strategy.addManyParentToChildRelationships([]);

        expect(mockedEval).not.toHaveBeenCalled();
        mockedEval.mockRestore();
    });
});

describe('RedisStrategy.clearRelationshipsForModel', () => {
    test('should use scanStream with correct pattern and pipeline srem', async () => {
        const scanStreamSpy = jest.spyOn(strategy.client, 'scanStream');

        // Mock scanStream to return an async iterator
        const mockKeys = [`${CacheNamespaces.RELATIONS_CHILD_TO_PARENT}:Model:child1`, `${CacheNamespaces.RELATIONS_CHILD_TO_PARENT}:Model:child2`];
        scanStreamSpy.mockReturnValue({
            [Symbol.asyncIterator]: async function* () {
                yield mockKeys;
            },
        } as any);

        const pipeline = strategy.client.pipeline();
        mockedRedisPipelineMethod.mockReturnValue(pipeline).mockClear();
        const mockedPipelineSrem = jest.spyOn(pipeline, 'srem').mockClear();
        const mockedPipelineExec = jest.spyOn(pipeline, 'exec').mockClear();

        await strategy.clearRelationshipsForModel('Parent:p1');

        // Should scan with correct pattern
        expect(scanStreamSpy).toHaveBeenCalledWith({
            match: `${CacheNamespaces.RELATIONS_CHILD_TO_PARENT}:*`,
            count: 100,
        });

        // Should pipeline srem for each key
        expect(mockedPipelineSrem).toHaveBeenCalledTimes(2);
        expect(mockedPipelineSrem).toHaveBeenCalledWith(`${CacheNamespaces.RELATIONS_CHILD_TO_PARENT}:Model:child1`, 'Parent:p1');
        expect(mockedPipelineSrem).toHaveBeenCalledWith(`${CacheNamespaces.RELATIONS_CHILD_TO_PARENT}:Model:child2`, 'Parent:p1');
        expect(mockedPipelineExec).toHaveBeenCalledTimes(1);

        scanStreamSpy.mockRestore();
    });
});

describe('RedisStrategy.clearDocumentsCache', () => {
    test('should use atomic Lua script to read and delete tracked document cache keys', async () => {
        const trackingKey = `${CacheNamespaces.DOCUMENT_CACHE_SETS}:id1`;
        const mockedEval = jest.spyOn(strategy.client, 'eval').mockResolvedValue(2);

        await strategy.clearDocumentsCache('id1');

        expect(mockedEval).toHaveBeenCalledWith(expect.stringContaining('SMEMBERS'), 1, trackingKey);

        mockedEval.mockRestore();
    });
});

describe('RedisStrategy.isValueCached', () => {
    beforeEach(async () => {
        await strategy.client.flushall();
    });

    test('should return true if value is cached', async () => {
        const namespace = 'testNamespace';
        const key = 'testKey';
        const value = 'testValue';
        const ttl = 60;

        // Add value to cache
        await strategy.addValueToCache(namespace, key, value, ttl);

        // Check if value is cached
        const isCached = await strategy.isValueCached(namespace, key);

        expect(isCached).toBe(true);
    });

    test('should return false if value is not cached', async () => {
        const namespace = 'testNamespace';
        const key = 'testKey';

        // Check if value is cached
        const isCached = await strategy.isValueCached(namespace, key);

        expect(isCached).toBe(false);
    });
});
