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
        expect(mockedRedisDelMethod).toBeCalledTimes(1);
        expect(mockedRedisDelMethod).toBeCalledWith('someNamespace:someKey');
    });
});

describe('RedisStrategy.addValueToCacheSet', () => {
    test(`should call sadd method on redis client with correct namespace and value`, () => {
        strategy.addValueToCacheSet('someNamespace', 'someValue');
        expect(mockedRedisSaddMethod).toBeCalledTimes(1);
        expect(mockedRedisSaddMethod).toBeCalledWith('someNamespace', 'someValue');
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

        expect(mockedRedisPipelineMethod).toBeCalledTimes(1);

        expect(mockedRedisPipelineSetMethod).toBeCalledTimes(1);
        expect(mockedRedisPipelineSetMethod).toBeCalledWith('someNamespace:someKey', '{"testKey":"testValue"}');

        expect(mockedRedisPipelineExpireMethod).toBeCalledTimes(1);
        expect(mockedRedisPipelineExpireMethod).toBeCalledWith('someNamespace:someKey', 123);

        expect(mockedRedisPipelineExecMethod).toBeCalledTimes(1);
    });
});

describe('RedisStrategy.getValueFromCache', () => {
    test(`should call sadd method on redis client with correct namespace and value with use of pipeline`, () => {
        strategy.getValueFromCache('someNamespace', 'someKey');
        expect(mockedRedisGetMethod).toBeCalledTimes(1);
        expect(mockedRedisGetMethod).toBeCalledWith('someNamespace:someKey');
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
        expect(mockedRedisSmembersMethod).toBeCalledTimes(1);
        expect(mockedRedisSmembersMethod).toBeCalledWith('someNamespace');
    });

    test(`should return value returned by the smembers method`, async () => {
        mockedRedisSmembersMethod.mockImplementation(async () => ['someValue']);
        const result = await strategy.getValuesFromCachedSet('someNamespace');

        expect(result).toEqual(['someValue']);
    });
});

describe('RedisStrategy.addValueToManyCachedSets', () => {
    test(`should call sadd method on redis client assigning value for each namespace`, () => {
        const pipeline = strategy.client.pipeline();
        mockedRedisPipelineMethod.mockReturnValue(pipeline).mockClear();

        const mockedRedisPipelineSaddMethod = jest.spyOn(pipeline, 'sadd').mockClear();
        const mockedRedisPipelineExecMethod = jest.spyOn(pipeline, 'exec').mockClear();
        const mockedRedisPipelineExpireMethod = jest.spyOn(pipeline, 'expire').mockClear();

        strategy.addValueToManyCachedSets(['nameSpace1', 'nameSpace2', 'nameSpace3'], 'someValue');

        expect(mockedRedisPipelineMethod).toBeCalledTimes(1);

        expect(mockedRedisPipelineSaddMethod).toBeCalledTimes(3);
        expect(mockedRedisPipelineSaddMethod).toBeCalledWith('nameSpace1', 'someValue');
        expect(mockedRedisPipelineSaddMethod).toBeCalledWith('nameSpace2', 'someValue');
        expect(mockedRedisPipelineSaddMethod).toBeCalledWith('nameSpace3', 'someValue');

        expect(mockedRedisPipelineExpireMethod).toBeCalledTimes(0);

        expect(mockedRedisPipelineExecMethod).toBeCalledTimes(1);
    });
});

describe('RedisStrategy.clearResultsCacheWithSet', () => {
    test(`should call del method on redis with the values assigned to given namespace`, async () => {
        const mockedGetValuesFromCachedSet = jest.spyOn(strategy, 'getValuesFromCachedSet').mockClear();
        mockedGetValuesFromCachedSet.mockImplementation(async () => ['someKey1', 'someKey2', 'someKey3']);
        const cachedSetsPreparedKeys = ['someKey1', 'someKey2', 'someKey3'].map(key => `${CacheNamespaces.RESULTS_NAMESPACE}:${key}`);

        await strategy.clearResultsCacheWithSet('someNamespace');
        expect(mockedRedisDelMethod).toBeCalledTimes(2);
        expect(mockedRedisDelMethod).toBeCalledWith(cachedSetsPreparedKeys);
        expect(mockedRedisDelMethod).toBeCalledWith('someNamespace');
    });
});

describe('RedisStrategy.refreshTTLForCachedResult', () => {
    test(`should call expire for given key`, async () => {
        const testData = { key: 'key1', ttl: 0.2 };
        const mockedExpire = jest.spyOn(strategy.client, 'expire');

        await strategy.refreshTTLForCachedResult(testData.key, testData.ttl);
        expect(mockedExpire).toBeCalledWith(`${CacheNamespaces.RESULTS_NAMESPACE}:${testData.key}`, testData.ttl);
    });
});
