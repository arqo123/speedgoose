import {InMemoryStrategy} from '../../src/cachingStrategies/inMemoryStrategy'

describe('InMemoryStrategy.isHydrationEnabled', () => {
    const strategy = new InMemoryStrategy()
   
    test(`should return false`, () => {
        expect(strategy.isHydrationEnabled()).toBeFalsy()
    })
})
