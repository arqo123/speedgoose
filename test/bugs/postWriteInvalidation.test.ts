/**
 * Regression: SpeedGooseCacheAutoCleaner invalidated only in PRE hooks (and did not even await the
 * clear, since it went through `model.emit`). A reader that missed the cache while the write was in
 * flight read the pre-write state from MongoDB and cached it, and nothing cleared it after the write
 * committed - stale until TTL. Upserts were not treated as new records either.
 *
 * Each case delays the write with a pre hook registered AFTER the plugin, runs a cached read inside
 * that window, releases the write, and checks the cache no longer serves the pre-write state.
 */
import mongoose, { Schema } from 'mongoose';
import Container from 'typedi';
import { applySpeedGooseCacheLayer } from '../../src/wrapper';
import { SpeedGooseCacheAutoCleaner } from '../../src/plugin/SpeedGooseCacheAutoCleaner';
import { SharedCacheStrategies } from '../../src/types/types';
import { clearTestCache, setupTestDB } from '../testUtils';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const gate = { armed: false, reached: () => {}, release: () => {} } as { armed: boolean; reached: () => void; release: () => void };
const delayWrite = async function () {
    if (!gate.armed) return;
    gate.armed = false;
    gate.reached();
    await new Promise<void>(resolve => (gate.release = resolve));
};

const RaceSchema = new Schema({ name: String, group: String });
RaceSchema.plugin(SpeedGooseCacheAutoCleaner);
// Registered after the plugin, so they run after speedgoose's pre hooks and right before the write.
RaceSchema.pre(['updateOne', 'findOneAndUpdate', 'updateMany', 'deleteOne'], delayWrite);
RaceSchema.pre('deleteOne', { document: true, query: false }, delayWrite);
RaceSchema.pre('save', delayWrite);
const RaceModel = mongoose.model('PostWriteInvalidationRace', RaceSchema);

type Doc = mongoose.HydratedDocument<{ name: string; group: string }>;

/** Runs `write` with a cached read of `read` happening while the write is held, returns the cached read after the write. */
const raceReadAgainstWrite = async <R>(read: () => Promise<R>, write: () => Promise<unknown>): Promise<{ inWindow: R; afterWrite: R }> => {
    await read(); // warm the cache
    const reached = new Promise<void>(resolve => (gate.reached = resolve));
    gate.armed = true;
    const pendingWrite = write();
    await reached;
    await sleep(50); // let any pre-hook invalidation settle
    const inWindow = await read(); // cache miss -> reads pre-write DB state -> caches it
    gate.release();
    await pendingWrite;
    await sleep(100); // let post-write invalidation settle
    return { inWindow, afterWrite: await read() };
};

describe('cache is invalidated after the database write, not only before it', () => {
    let doc: Doc;
    const readById = async () => (await RaceModel.findById(doc._id).lean().cacheQuery({ ttl: 600 })) as any;

    beforeAll(async () => setupTestDB());
    afterAll(async () => {
        await mongoose.connection.close();
        await mongoose.disconnect();
    });

    beforeEach(async () => {
        Container.reset();
        await applySpeedGooseCacheLayer(mongoose, { sharedCacheStrategy: SharedCacheStrategies.IN_MEMORY });
        await clearTestCache();
        gate.armed = false;
        await RaceModel.deleteMany({});
        doc = (await RaceModel.create({ name: 'old', group: 'g' })) as Doc;
        await RaceModel.create({ name: 'old', group: 'g' });
    });

    it('query updateOne', async () => {
        const { inWindow, afterWrite } = await raceReadAgainstWrite(readById, () => RaceModel.updateOne({ _id: doc._id }, { name: 'new' }).exec());
        expect(inWindow.name).toBe('old');
        expect(afterWrite.name).toBe('new');
    });

    it('findOneAndUpdate', async () => {
        const { afterWrite } = await raceReadAgainstWrite(readById, () => RaceModel.findOneAndUpdate({ _id: doc._id }, { name: 'new' }).exec());
        expect(afterWrite.name).toBe('new');
    });

    it('query deleteOne', async () => {
        const { inWindow, afterWrite } = await raceReadAgainstWrite(readById, () => RaceModel.deleteOne({ _id: doc._id }).exec());
        expect(inWindow?.name).toBe('old');
        expect(afterWrite).toBeNull();
    });

    it('document deleteOne', async () => {
        // Already passes on the pre-fix code (document deleteOne only had a post hook); guards against regressions.
        const { inWindow, afterWrite } = await raceReadAgainstWrite(readById, async () => doc.deleteOne()); // async: deleteOne() returns a lazy thenable
        expect(inWindow?.name).toBe('old');
        expect(afterWrite).toBeNull();
    });

    it('updateMany', async () => {
        const readGroup = async () => (await RaceModel.find({ group: 'g' }).lean().cacheQuery({ ttl: 600 })) as any[];
        const { afterWrite } = await raceReadAgainstWrite(readGroup, () => RaceModel.updateMany({ group: 'g' }, { name: 'new' }).exec());
        expect(afterWrite.map(d => d.name)).toEqual(['new', 'new']);
    });

    it('save of an existing document', async () => {
        const { afterWrite } = await raceReadAgainstWrite(readById, () => {
            doc.name = 'new';
            return doc.save();
        });
        expect(afterWrite.name).toBe('new');
    });

    it.each([
        ['updateOne', () => RaceModel.updateOne({ name: 'upserted', group: 'g' }, { $set: { name: 'upserted' } }, { upsert: true }).exec()],
        ['findOneAndUpdate', () => RaceModel.findOneAndUpdate({ name: 'upserted', group: 'g' }, { $set: { name: 'upserted' } }, { upsert: true, new: true }).exec()],
    ])('upsert via %s is treated as a new record (model-wide cached query sees it)', async (_label, upsert) => {
        const readGroup = async () => (await RaceModel.find({ group: 'g' }).lean().cacheQuery({ ttl: 600 })) as any[];
        expect(await readGroup()).toHaveLength(2);

        await upsert();
        await sleep(100);

        expect(await RaceModel.countDocuments({ group: 'g' })).toBe(3);
        expect(await readGroup()).toHaveLength(3);
    });
});
