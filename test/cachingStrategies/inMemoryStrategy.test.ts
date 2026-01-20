import { InMemoryStrategy } from '../../src/cachingStrategies/inMemoryStrategy';
import { CacheNamespaces } from '../../src/types/types';
import { getCacheStrategyInstance } from '../../src/utils/commonUtils';
import { wait } from '../testUtils';


describe('InMemoryStrategy.isHydrationEnabled', () => {
    const strategy = new InMemoryStrategy();

    test(`should return false`, () => {
        expect(strategy.isHydrationEnabled()).toBeFalsy();
    });
});

describe('InMemoryStrategy.getValueFromCache', () => {
    test(`should return null in case the value was not found in the cache`, async () => {
        const strategy = getCacheStrategyInstance();
        const result = await strategy.getValueFromCache(CacheNamespaces.RESULTS_NAMESPACE, 'randomKey');

        expect(result).toBeNull();
    });
});

describe('InMemoryStrategy.refreshTTLForCachedResult', () => {
    test(`should call re-set entry with passed data and`, async () => {
        const strategy = getCacheStrategyInstance();

        const testData = { key: 'key1', ttl: 0.2, value: {} };
        await strategy.removeKeyForCache(CacheNamespaces.RESULTS_NAMESPACE, testData.key);
        await strategy.addValueToCache(CacheNamespaces.RESULTS_NAMESPACE, testData.key, testData.value, testData.ttl);
        // At first check if it was really set
        // Exec time = 0 ms
        expect(await strategy.getValueFromCache(CacheNamespaces.RESULTS_NAMESPACE, testData.key)).toEqual(testData.value);
        await wait(100);
        // Exec time = 100 ms so the key still have like 100 ms
        await strategy.refreshTTLForCachedResult(testData.key, testData.ttl, testData.value);
        await wait(110);
        // Exec time =~ 210 so if the ttl was not refreshed the key should gone
        expect(await strategy.getValueFromCache(CacheNamespaces.RESULTS_NAMESPACE, testData.key)).toEqual(testData.value);
    });
});

describe('InMemoryStrategy.isValueCached', () => {
  let strategy
  beforeEach(async () => {
    strategy = getCacheStrategyInstance();

    // Clear the cache before each test
    await strategy.removeKeyForCache(CacheNamespaces.RESULTS_NAMESPACE, 'test-key');
  });

  test('should return false when the value is not cached', async () => {
    const isCached = await strategy.isValueCached(CacheNamespaces.RESULTS_NAMESPACE, 'test-key');
    expect(isCached).toBe(false);
  });

  test('should return true when the value is cached', async () => {
    const testData = { key: 'test-key', ttl: 0.2, value: {} };
    await strategy.addValueToCache(CacheNamespaces.RESULTS_NAMESPACE, testData.key, testData.value, testData.ttl);

    const isCached = await strategy.isValueCached(CacheNamespaces.RESULTS_NAMESPACE, testData.key);
    expect(isCached).toBe(true);
  });
});
