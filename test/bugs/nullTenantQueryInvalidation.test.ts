/**
 * Regression: a `{ tenantId: null }` query was tracked under `<Model>_null`, while document events
 * map a null/missing tenant to the model-wide `<Model>_` key, so inserting a matching document
 * never invalidated the cached (empty) result.
 * Expected: a null tenant filter is tracked under the model-wide key.
 */
import mongoose, { Schema } from 'mongoose';
import Container from 'typedi';
import { applySpeedGooseCacheLayer } from '../../src/wrapper';
import { SpeedGooseCacheAutoCleaner } from '../../src/plugin/SpeedGooseCacheAutoCleaner';
import { SharedCacheStrategies } from '../../src/types/types';
import { clearTestCache, setupTestDB } from '../testUtils';

const schema = new Schema({ tenantId: String, name: String });
schema.plugin(SpeedGooseCacheAutoCleaner);
const TenantItem = mongoose.models.NullTenantItem ?? mongoose.model('NullTenantItem', schema);

const waitForInvalidation = () => new Promise(resolve => setTimeout(resolve, 100));

describe('null tenant query invalidation', () => {
    beforeAll(async () => setupTestDB(), 60000);
    afterAll(async () => {
        await mongoose.connection.close();
        await mongoose.disconnect();
    });

    beforeEach(async () => {
        Container.reset();
        await applySpeedGooseCacheLayer(mongoose, { sharedCacheStrategy: SharedCacheStrategies.IN_MEMORY, multitenancyConfig: { multitenantKey: 'tenantId' } });
        await clearTestCache();
        await TenantItem.deleteMany({});
    });

    test('inserting a document with tenantId null invalidates a cached { tenantId: null } query', async () => {
        const query = () => TenantItem.find({ tenantId: null, name: 'a' }).lean().cacheQuery();
        expect(await query()).toHaveLength(0);

        await TenantItem.create({ tenantId: null, name: 'a' });
        await waitForInvalidation();

        expect(await query()).toHaveLength(1);
    });

    test('inserting a document without the tenant field invalidates a cached { tenantId: null } query', async () => {
        const query = () => TenantItem.find({ tenantId: null, name: 'b' }).lean().cacheQuery();
        expect(await query()).toHaveLength(0);

        await TenantItem.create({ name: 'b' });
        await waitForInvalidation();

        expect(await query()).toHaveLength(1);
    });

    test('a tenant-scoped query is still invalidated by an insert of that tenant', async () => {
        const query = () => TenantItem.find({ tenantId: 't1', name: 'c' }).lean().cacheQuery();
        expect(await query()).toHaveLength(0);

        await TenantItem.create({ tenantId: 't1', name: 'c' });
        await waitForInvalidation();

        expect(await query()).toHaveLength(1);
    });
});
