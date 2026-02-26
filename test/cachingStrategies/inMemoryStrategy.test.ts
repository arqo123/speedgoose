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

describe('InMemoryStrategy.addManyParentToChildRelationships', () => {
    test('should batch add multiple relationships at once', async () => {
        const strategy = getCacheStrategyInstance();

        await strategy.addManyParentToChildRelationships([
            { childIdentifier: 'rel:child:Model:c1', parentIdentifier: 'Parent:p1' },
            { childIdentifier: 'rel:child:Model:c1', parentIdentifier: 'Parent:p2' },
            { childIdentifier: 'rel:child:Model:c2', parentIdentifier: 'Parent:p1' },
        ]);

        const parentsOfC1 = await strategy.getParentsOfChild('rel:child:Model:c1');
        expect(parentsOfC1.sort()).toEqual(['Parent:p1', 'Parent:p2']);

        const parentsOfC2 = await strategy.getParentsOfChild('rel:child:Model:c2');
        expect(parentsOfC2).toEqual(['Parent:p1']);
    });

    test('should handle empty relationships array', async () => {
        const strategy = getCacheStrategyInstance();
        await strategy.addManyParentToChildRelationships([]);
        // Should not throw
    });

    test('should merge with existing relationships', async () => {
        const strategy = getCacheStrategyInstance();

        // Pre-existing relationship
        await strategy.addParentToChildRelationship('rel:child:Model:c3', 'Parent:existing');

        // Add more
        await strategy.addManyParentToChildRelationships([
            { childIdentifier: 'rel:child:Model:c3', parentIdentifier: 'Parent:new1' },
            { childIdentifier: 'rel:child:Model:c3', parentIdentifier: 'Parent:new2' },
        ]);

        const parents = await strategy.getParentsOfChild('rel:child:Model:c3');
        expect(parents.sort()).toEqual(['Parent:existing', 'Parent:new1', 'Parent:new2']);
    });
});

describe('InMemoryStrategy.clearDocumentsCache', () => {
    test('should delete all document cache entries matching namespace', async () => {
        const strategy = getCacheStrategyInstance();

        const docs = new Map();
        docs.set('doc:User:id1', { name: 'User1' });
        docs.set('doc:User:id2', { name: 'User2' });
        docs.set('doc:Post:id1', { title: 'Post1' });
        await strategy.setDocuments(docs, 60);

        await strategy.clearDocumentsCache('doc:User');

        const remaining = await strategy.getDocuments(['doc:User:id1', 'doc:User:id2', 'doc:Post:id1']);
        expect(remaining.has('doc:User:id1')).toBe(false);
        expect(remaining.has('doc:User:id2')).toBe(false);
        expect(remaining.has('doc:Post:id1')).toBe(true);
    });
});

describe('InMemoryStrategy.clearRelationshipsForModel', () => {
    test('should remove parentIdentifier from all relationship sets', async () => {
        const strategy = getCacheStrategyInstance();
        const suffix = Date.now();

        await strategy.addParentToChildRelationship(`rel:child:Model:clear_c1_${suffix}`, `Parent:clear_p1_${suffix}`);
        await strategy.addParentToChildRelationship(`rel:child:Model:clear_c1_${suffix}`, `Parent:clear_p2_${suffix}`);
        await strategy.addParentToChildRelationship(`rel:child:Model:clear_c2_${suffix}`, `Parent:clear_p1_${suffix}`);

        await strategy.clearRelationshipsForModel(`Parent:clear_p1_${suffix}`);

        const parentsOfC1 = await strategy.getParentsOfChild(`rel:child:Model:clear_c1_${suffix}`);
        expect(parentsOfC1).toEqual([`Parent:clear_p2_${suffix}`]);

        const parentsOfC2 = await strategy.getParentsOfChild(`rel:child:Model:clear_c2_${suffix}`);
        expect(parentsOfC2).toEqual([]);
    });
});

describe('InMemoryStrategy.isValueCached', () => {
    let strategy;
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
