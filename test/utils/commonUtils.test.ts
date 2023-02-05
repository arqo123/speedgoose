import Container from 'typedi';
import { GlobalDiContainerRegistryNames, SpeedGooseConfig } from '../../src/types/types';
import { getConfig, isCachingEnabled, objectDeserializer, objectSerializer } from '../../src/utils/commonUtils';
import { TEST_SPEEDGOOSE_CONFIG } from '../constants';

describe(`getConfig`, () => {
    test(`should return test config registered in DiContainer`, () => {
        expect(getConfig()).toMatchObject(TEST_SPEEDGOOSE_CONFIG);
    });
});

describe(`objectSerializer`, () => {
    test(`should return object without mutating it`, () => {
        const testObject = { a: '1', b: '2', c: 'c' };
        //in that case we also want to compare if it's the same object or some kind of copy
        expect(objectSerializer(testObject)).toEqual(testObject);
        expect(objectSerializer(testObject)).toMatchObject(testObject);
    });
});

describe(`objectDeserializer`, () => {
    test(`should return object without mutating it`, () => {
        const testObject = { a: '1', b: '2', c: 'c' };
        //in that case we also want to compare if it's the same object or some kind of copy
        expect(objectDeserializer(testObject)).toEqual(testObject);
        expect(objectDeserializer(testObject)).toMatchObject(testObject);
    });
});
describe(`isCachingEnabled`, () => {
    it(`it should return true when caching is enabled in config`, async () => {
        Container.remove(GlobalDiContainerRegistryNames.CONFIG_GLOBAL_ACCESS);
        Container.set(GlobalDiContainerRegistryNames.CONFIG_GLOBAL_ACCESS, <SpeedGooseConfig>{ enabled: true });

        expect(isCachingEnabled()).toBeTruthy();
    });

    it(`it should return false when caching is disabled in config`, async () => {
        Container.remove(GlobalDiContainerRegistryNames.CONFIG_GLOBAL_ACCESS);
        Container.set(GlobalDiContainerRegistryNames.CONFIG_GLOBAL_ACCESS, <SpeedGooseConfig>{ enabled: false });

        expect(isCachingEnabled()).toBeFalsy();
    });
});
