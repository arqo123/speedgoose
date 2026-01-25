import Container from 'typedi';
import { GlobalDiContainerRegistryNames, SpeedGooseConfig } from '../../src/types/types';
import { customStringifyReplacer, getCacheStrategyInstance, getConfig, getHydrationCache, getHydrationVariationsCache, isCachingEnabled, objectDeserializer, objectSerializer } from '../../src/utils/commonUtils';
import { TEST_SPEEDGOOSE_CONFIG } from '../constants';

describe(`getConfig`, () => {
    test(`should return test config registered in DiContainer`, () => {
        expect(getConfig()).toMatchObject(TEST_SPEEDGOOSE_CONFIG);
    });

    test(`should return null when config is not registered in DiContainer`, () => {
        Container.remove(GlobalDiContainerRegistryNames.CONFIG_GLOBAL_ACCESS);
        expect(getConfig()).toBeNull();
        // Restore config for other tests
        Container.set(GlobalDiContainerRegistryNames.CONFIG_GLOBAL_ACCESS, TEST_SPEEDGOOSE_CONFIG);
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

    it(`should return false when config is not registered in DI container`, () => {
        Container.remove(GlobalDiContainerRegistryNames.CONFIG_GLOBAL_ACCESS);
        expect(isCachingEnabled()).toBe(false);
        // Restore config for other tests
        Container.set(GlobalDiContainerRegistryNames.CONFIG_GLOBAL_ACCESS, TEST_SPEEDGOOSE_CONFIG);
    });
});

describe('Cache-related functions', () => {
    let containerGetSpy;

    beforeEach(() => {
        containerGetSpy = jest.spyOn(Container, 'get').mockReset();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should return the Hydration Cache', () => {
        const mockCache = {}; // your mock cache object
        containerGetSpy.mockReturnValueOnce(mockCache);

        const result = getHydrationCache();

        expect(containerGetSpy).toHaveBeenCalledTimes(1);
        expect(containerGetSpy).toHaveBeenCalledWith(GlobalDiContainerRegistryNames.HYDRATED_DOCUMENTS_CACHE_ACCESS);
        expect(result).toEqual(mockCache);
    });

    it('should return the Hydration Variations Cache', () => {
        const mockCache = {}; // your mock cache object
        containerGetSpy.mockReturnValueOnce(mockCache).nic;

        const result = getHydrationVariationsCache();

        expect(containerGetSpy).toHaveBeenCalledTimes(1);
        expect(containerGetSpy).toHaveBeenCalledWith(GlobalDiContainerRegistryNames.HYDRATED_DOCUMENTS_VARIATIONS_CACHE_ACCESS);
        expect(result).toEqual(mockCache);
    });

    it('should return the Cache Strategy Instance', () => {
        const mockCacheStrategy = {}; // your mock CacheStrategiesTypes object
        containerGetSpy.mockReturnValueOnce(mockCacheStrategy);

        const result = getCacheStrategyInstance();

        expect(containerGetSpy).toHaveBeenCalledTimes(1);
        expect(containerGetSpy).toHaveBeenCalledWith(GlobalDiContainerRegistryNames.CACHE_CLIENT_GLOBAL_ACCESS);
        expect(result).toEqual(mockCacheStrategy);
    });
});

describe(`customStringifyReplacer`, () => {
    test(`should return 'regex:' prefixed string for RegExp objects`, () => {
        const regex = new RegExp('test');
        expect(customStringifyReplacer('key', regex)).toBe('regex:/test/');
    });

    test(`should return the original value for non-RegExp objects`, () => {
        const value = 'test';
        expect(customStringifyReplacer('key', value)).toBe(value);
    });
});