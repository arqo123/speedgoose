type Flight = { promise: Promise<unknown>; joined: number };

const inflightRequests = new Map<string, Flight>();

/** Passed to the function run by `singleflight`. */
export type FlightControl = {
    /**
     * Stops other callers from joining this flight and returns how many already joined. Callers that come later
     * start a new flight. Useful to do extra work (like copying the result) only when someone is waiting for it.
     */
    closeFlight: () => number;
};

/**
 * Ensures only one execution of `fn` per unique `key` at any given time.
 * Concurrent callers with the same key share the same promise.
 * The entry is removed from the map once the promise settles (resolves or rejects), or when `fn` calls `closeFlight()`.
 *
 * This prevents the "thundering herd" / N+1 problem where N concurrent cache misses
 * for the same key would all independently hit the database.
 * Callers must ensure the same key is always used with the same result type T.
 */
export const singleflight = <T>(key: string, fn: (control: FlightControl) => Promise<T>): Promise<T> => {
    const existing = inflightRequests.get(key);
    if (existing) {
        existing.joined++;
        return existing.promise as Promise<T>;
    }

    const flight: Flight = { promise: undefined, joined: 0 };
    const close = (): void => {
        // A newer flight may already use this key.
        if (inflightRequests.get(key) === flight) inflightRequests.delete(key);
    };
    const closeFlight = (): number => {
        close();
        return flight.joined;
    };

    inflightRequests.set(key, flight);
    flight.promise = fn({ closeFlight }).finally(close);
    return flight.promise as Promise<T>;
};

/** @internal — test only */
export const getInflightCount = (): number => inflightRequests.size;

/** @internal — test only */
export const clearInflightRequests = (): void => {
    inflightRequests.clear();
};
