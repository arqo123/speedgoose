const inflightRequests = new Map<string, Promise<unknown>>();

/**
 * Ensures only one execution of `fn` per unique `key` at any given time.
 * Concurrent callers with the same key share the same promise.
 * The entry is removed from the map once the promise settles (resolves or rejects).
 *
 * This prevents the "thundering herd" / N+1 problem where N concurrent cache misses
 * for the same key would all independently hit the database.
 */
export const singleflight = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const existing = inflightRequests.get(key);
    if (existing) {
        return existing as Promise<T>;
    }

    const promise = fn().finally(() => {
        inflightRequests.delete(key);
    });

    inflightRequests.set(key, promise);
    return promise;
};

/** @internal — test only */
export const getInflightCount = (): number => inflightRequests.size;

/** @internal — test only */
export const clearInflightRequests = (): void => {
    inflightRequests.clear();
};
