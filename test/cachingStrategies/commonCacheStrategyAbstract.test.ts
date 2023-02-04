import { CommonCacheStrategyAbstract } from '../../src/cachingStrategies/commonCacheStrategyAbstract';

describe('CommonCacheStrategyAbstract.isHydrationEnabled', () => {
    //@ts-expect-error we just wont to check the methods that are inside CommonCacheStrategyAbstract
    class SomeNewStrategy extends CommonCacheStrategyAbstract {}
    const strategy = new SomeNewStrategy();

    test(`should return true`, () => {
        expect(strategy.isHydrationEnabled()).toBeTruthy();
    });
});
