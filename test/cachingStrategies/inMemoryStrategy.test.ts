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
