/**
 * Regression: parent invalidation took the record id from the relationship member
 * `<ParentModel>:<id>` with `split(':').pop()`, so a parent `_id` containing colons
 * (e.g. 'org:acme:42') cleared record '42' and left the parent's cached results stale.
 * Covers clearParentCache (updateOne) and clearParentCacheBulk (updateMany).
 */
import mongoose, { Schema } from 'mongoose';
import Container from 'typedi';
import { applySpeedGooseCacheLayer } from '../../src/wrapper';
import { SpeedGooseCacheAutoCleaner } from '../../src/plugin/SpeedGooseCacheAutoCleaner';
import { SharedCacheStrategies } from '../../src/types/types';
import { isCached } from '../../src/utils/cacheClientUtils';
import { clearTestCache, setupTestDB } from '../testUtils';

const childSchema = new Schema({ name: String });
childSchema.plugin(SpeedGooseCacheAutoCleaner);
const ColonChild = mongoose.models.ColonChild ?? mongoose.model('ColonChild', childSchema);

const parentSchema = new Schema({ _id: String, child: { type: Schema.Types.ObjectId, ref: 'ColonChild' } });
parentSchema.plugin(SpeedGooseCacheAutoCleaner);
const ColonParent = mongoose.models.ColonParent ?? mongoose.model('ColonParent', parentSchema);

const waitForInvalidation = () => new Promise(resolve => setTimeout(resolve, 100));

describe('parent invalidation for _ids containing colons', () => {
    beforeAll(async () => setupTestDB(), 60000);
    afterAll(async () => {
        await mongoose.connection.close();
        await mongoose.disconnect();
    });

    beforeEach(async () => {
        Container.reset();
        await applySpeedGooseCacheLayer(mongoose, { sharedCacheStrategy: SharedCacheStrategies.IN_MEMORY });
        await clearTestCache();
        await Promise.all([ColonChild.deleteMany({}), ColonParent.deleteMany({})]);
    });

    const cacheParent = async (parentId: string) => {
        const child = await ColonChild.create({ name: 'v1' });
        await ColonParent.create({ _id: parentId, child: child._id });
        const cacheKey = `colon-parent:${parentId}`;
        await ColonParent.findById(parentId).lean().cachePopulate('child').cacheQuery({ cacheKey });
        expect(await isCached(cacheKey)).toBe(true);
        return { child, cacheKey };
    };

    test.each([
        ['without a colon', 'plain-42'],
        ['containing colons', 'org:acme:42'],
    ])('updateOne on the child clears a parent whose _id is %s', async (_label, parentId) => {
        const { child, cacheKey } = await cacheParent(parentId);

        await ColonChild.updateOne({ _id: child._id }, { name: 'v2' });
        await waitForInvalidation();

        expect(await isCached(cacheKey)).toBe(false);
    });

    test('updateMany on the children clears a parent whose _id contains colons', async () => {
        const { child, cacheKey } = await cacheParent('org:acme:43');

        await ColonChild.updateMany({ _id: child._id }, { name: 'v2' });
        await waitForInvalidation();

        expect(await isCached(cacheKey)).toBe(false);
    });
});
