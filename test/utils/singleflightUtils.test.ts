import { singleflight, getInflightCount, clearInflightRequests } from '../../src/utils/singleflightUtils';

describe('singleflightUtils', () => {
    afterEach(() => {
        clearInflightRequests();
    });

    describe('singleflight', () => {
        it('should execute the factory and return its result', async () => {
            const result = await singleflight('key1', async () => 42);
            expect(result).toBe(42);
        });

        it('should call factory only once for concurrent calls with the same key', async () => {
            let callCount = 0;
            const factory = async () => {
                callCount++;
                await new Promise(resolve => setTimeout(resolve, 50));
                return 'shared-result';
            };

            const results = await Promise.all([
                singleflight('key1', factory),
                singleflight('key1', factory),
                singleflight('key1', factory),
            ]);

            expect(callCount).toBe(1);
            expect(results).toEqual(['shared-result', 'shared-result', 'shared-result']);
        });

        it('should call factory separately for different keys', async () => {
            let callCount = 0;
            const factory = () => {
                callCount++;
                return Promise.resolve(`result-${callCount}`);
            };

            await Promise.all([
                singleflight('key-a', factory),
                singleflight('key-b', factory),
            ]);

            expect(callCount).toBe(2);
        });

        it('should propagate errors to all waiters', async () => {
            const factory = async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
                throw new Error('boom');
            };

            const results = await Promise.allSettled([
                singleflight('key1', factory),
                singleflight('key1', factory),
                singleflight('key1', factory),
            ]);

            for (const result of results) {
                expect(result.status).toBe('rejected');
                if (result.status === 'rejected') {
                    expect(result.reason.message).toBe('boom');
                }
            }
        });

        it('should clean up after success, allowing new calls with the same key', async () => {
            let callCount = 0;
            const factory = async () => ++callCount;

            const result1 = await singleflight('key1', factory);
            expect(result1).toBe(1);
            expect(getInflightCount()).toBe(0);

            const result2 = await singleflight('key1', factory);
            expect(result2).toBe(2);
            expect(getInflightCount()).toBe(0);
        });

        it('should clean up after error, allowing retry', async () => {
            let callCount = 0;
            const factory = async () => {
                callCount++;
                if (callCount === 1) throw new Error('transient failure');
                return 'success';
            };

            await expect(singleflight('key1', factory)).rejects.toThrow('transient failure');
            expect(getInflightCount()).toBe(0);

            const result = await singleflight('key1', factory);
            expect(result).toBe('success');
        });

        it('should handle concurrent calls where some arrive after initial promise settles', async () => {
            let callCount = 0;
            const factory = async () => {
                callCount++;
                return `call-${callCount}`;
            };

            // First batch
            const result1 = await singleflight('key1', factory);
            expect(result1).toBe('call-1');

            // Second batch (after first settled)
            const result2 = await singleflight('key1', factory);
            expect(result2).toBe('call-2');

            expect(callCount).toBe(2);
        });

        it('should track inflight count correctly during concurrent calls', async () => {
            expect(getInflightCount()).toBe(0);

            let resolveFactory: () => void;
            const blockingPromise = new Promise<void>(resolve => {
                resolveFactory = resolve;
            });

            const factory = async () => {
                await blockingPromise;
                return 'done';
            };

            const p1 = singleflight('key1', factory);
            const p2 = singleflight('key2', factory);

            expect(getInflightCount()).toBe(2);

            // key1 has an inflight, so this joins it (doesn't create a new one)
            const p3 = singleflight('key1', factory);
            expect(getInflightCount()).toBe(2);

            resolveFactory!();
            await Promise.all([p1, p2, p3]);

            expect(getInflightCount()).toBe(0);
        });

        it('should return undefined when factory returns undefined', async () => {
            const result = await singleflight('key1', async () => undefined);
            expect(result).toBeUndefined();
        });

        it('should handle null results correctly', async () => {
            const result = await singleflight('key1', async () => null);
            expect(result).toBeNull();
        });

        it('should preserve result type for complex objects', async () => {
            const data = { users: [{ id: 1, name: 'Alice' }], total: 1 };
            const results = await Promise.all([
                singleflight('key1', async () => {
                    await new Promise(resolve => setTimeout(resolve, 10));
                    return data;
                }),
                singleflight('key1', async () => {
                    return { different: true };
                }),
            ]);

            // Both should get the first factory's result
            expect(results[0]).toBe(data);
            expect(results[1]).toBe(data);
        });
    });

    describe('clearInflightRequests', () => {
        it('should clear all inflight entries', async () => {
            let resolve1: () => void;
            let resolve2: () => void;
            const p1 = new Promise<void>(r => { resolve1 = r; });
            const p2 = new Promise<void>(r => { resolve2 = r; });

            singleflight('a', () => p1.then(() => 'a'));
            singleflight('b', () => p2.then(() => 'b'));

            expect(getInflightCount()).toBe(2);
            clearInflightRequests();
            expect(getInflightCount()).toBe(0);

            resolve1!();
            resolve2!();
        });
    });
});
