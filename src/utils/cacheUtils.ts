import { InMemoryStrategy } from '../cachingStrategies/inMemoryStrategy';
import { getCacheStrategyInstance } from './commonUtils';

/** Clears the in-memory cache of this process. A shared Redis cache is not touched. */
export const clearAllCaches = async (): Promise<void> => {
    const strategy = getCacheStrategyInstance();

    if (strategy instanceof InMemoryStrategy) {
        await strategy.clearAll();
    }
};
