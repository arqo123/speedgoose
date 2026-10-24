/**
 * Regression: when a child document changed, only the child id was published on RECORDS_CHANGED.
 * Parent hydration caches were cleared locally only, so other instances (Redis strategy, per-process
 * hydration cache) kept serving the parent hydrated with the old child until TTL.
 */
import mongoose from 'mongoose';
import Container from 'typedi';
import { applySpeedGooseCacheLayer } from '../../src/wrapper';
import { SharedCacheStrategies, SpeedGooseRedisChannels } from '../../src/types/types';
import { getCacheStrategyInstance } from '../../src/utils/commonUtils';
import { getRedisInstance } from '../../src/utils/redisUtils';
import { UserModel, clearTestCache, setupTestDB } from '../testUtils';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const publishedIds = (spy: jest.SpyInstance): string[] =>
    spy.mock.calls
        .filter(([channel]) => channel === SpeedGooseRedisChannels.RECORDS_CHANGED)
        .flatMap(([, message]) => {
            const parsed = JSON.parse(message as string);
            return (Array.isArray(parsed) ? parsed : [parsed]).map(String);
        });

describe('parent hydration invalidation is broadcast to other instances', () => {
    beforeAll(async () => setupTestDB());
    afterAll(async () => {
        await mongoose.connection.close();
        await mongoose.disconnect();
    });

    beforeEach(async () => {
        Container.reset();
        await applySpeedGooseCacheLayer(mongoose, { redisUri: 'redis://localhost:6379', sharedCacheStrategy: SharedCacheStrategies.REDIS });
        await clearTestCache();
        await UserModel.deleteMany({});
    });

    afterEach(() => jest.restoreAllMocks());

    it.each([
        ['updateOne', (childId: unknown) => UserModel.updateOne({ _id: childId }, { name: 'child-v2' }).exec()],
        ['updateMany', (childId: unknown) => UserModel.updateMany({ _id: childId }, { name: 'child-v2' }).exec()],
        [
            'save',
            async (childId: unknown) => {
                const child = await UserModel.findById(childId);
                child!.name = 'child-v2';
                return child!.save();
            },
        ],
    ])('publishes parent ids on RECORDS_CHANGED when a populated child changes (%s)', async (_label, changeChild) => {
        const child = await UserModel.create({ name: 'child', email: 'c' });
        const parent = await UserModel.create({ name: 'parent', email: 'p', relationField: child._id });
        await UserModel.findById(parent._id).cachePopulate({ path: 'relationField' }).cacheQuery({ ttl: 600 });
        expect(await getCacheStrategyInstance().getParentsOfChild(`rel:child:User:${child._id}`)).toEqual([`User:${parent._id}`]);

        const publishSpy = jest.spyOn(getRedisInstance(), 'publish');
        publishSpy.mockClear(); // only count what the child change publishes
        await changeChild(child._id);
        await sleep(100);

        const ids = publishedIds(publishSpy);
        expect(ids).toContain(String(child._id));
        expect(ids).toContain(String(parent._id));
    });
});
