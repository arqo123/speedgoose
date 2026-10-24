/**
 * Regression: a later populate with a shorter ttl shrank the TTL of a child's parent-relationship set,
 * so after it expired a child update no longer found the parent whose result was cached for longer.
 * Expected: relationship set TTL is only ever extended, in both strategies.
 */
import mongoose from 'mongoose';
import Container from 'typedi';
import Keyv from 'keyv';
import { applySpeedGooseCacheLayer } from '../../src/wrapper';
import { SharedCacheStrategies } from '../../src/types/types';
import { getCacheStrategyInstance } from '../../src/utils/commonUtils';
import { RedisStrategy } from '../../src/cachingStrategies/redisStrategy';
import { setupTestDB } from '../testUtils';

const CHILD = 'rel:child:User:relationship-ttl-child';

const remainingTtl = async (strategy: SharedCacheStrategies): Promise<number> => {
    if (strategy === SharedCacheStrategies.REDIS) {
        return (getCacheStrategyInstance() as RedisStrategy).client.ttl(CHILD);
    }
    const relationsClient: Keyv<any> = (getCacheStrategyInstance() as any).relationsCacheClient;
    const raw: any = await relationsClient.get(CHILD, { raw: true });
    return typeof raw?.expires === 'number' ? (raw.expires - Date.now()) / 1000 : -1;
};

describe('relationship sets never shrink their TTL', () => {
    beforeAll(async () => setupTestDB(), 60000);
    afterAll(async () => {
        await mongoose.connection.close();
        await mongoose.disconnect();
    });

    it.each([SharedCacheStrategies.IN_MEMORY, SharedCacheStrategies.REDIS])('%s', async sharedCacheStrategy => {
        Container.reset();
        await applySpeedGooseCacheLayer(mongoose, { redisUri: 'redis://localhost:6379', sharedCacheStrategy });
        const cacheStrategy = getCacheStrategyInstance();
        await cacheStrategy.removeChildRelationships(CHILD);

        await cacheStrategy.addManyParentToChildRelationships([{ childIdentifier: CHILD, parentIdentifier: 'User:parent-a' }], 3600, 10000);
        await cacheStrategy.addManyParentToChildRelationships([{ childIdentifier: CHILD, parentIdentifier: 'User:parent-b' }], 120, 10000);

        expect(await remainingTtl(sharedCacheStrategy)).toBeGreaterThan(3500);
        expect(await cacheStrategy.getParentsOfChild(CHILD)).toEqual(expect.arrayContaining(['User:parent-a', 'User:parent-b']));
    });
});
