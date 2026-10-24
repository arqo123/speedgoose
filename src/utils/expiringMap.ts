import Keyv from 'keyv';

type KeyvEntry = { expires?: number | null };

const SWEEP_MIN_WRITES = 100;
const SWEEP_INTERVAL_MS = 1000;

const isExpired = (entry: KeyvEntry | undefined, now = Date.now()): boolean => typeof entry?.expires === 'number' && now > entry.expires;

/**
 * Keyv store for the in-memory clients. Keyv's default Map drops an expired entry only when that
 * key is read again, so a key that is never read again (e.g. a unique query key) stays in memory forever.
 * This Map also sweeps expired entries as writes come in: a full pass after as many writes as it holds
 * entries, or a second after the last pass once writes reach a tenth of its size (amortized O(1) per write).
 * No timers.
 */
export class ExpiringMap<V extends KeyvEntry = KeyvEntry> extends Map<string, V> {
    private writesSinceSweep = 0;
    private lastSweepAt = Date.now();

    public set(key: string, value: V): this {
        super.set(key, value);
        this.writesSinceSweep = (this.writesSinceSweep ?? 0) + 1;
        const dueByWrites = this.writesSinceSweep >= Math.max(SWEEP_MIN_WRITES, this.size);
        // A timed pass still needs some writes since the last one, so a large map is not walked every second.
        const dueByTime = this.writesSinceSweep >= this.size / 10 && Date.now() - this.lastSweepAt >= SWEEP_INTERVAL_MS;
        if (dueByWrites || dueByTime) {
            this.sweep();
        }
        return this;
    }

    /** Keyv uses `has` as is, so it must not report expired entries. */
    public has(key: string): boolean {
        const entry = super.get(key);
        if (entry === undefined) return false;
        if (isExpired(entry)) {
            super.delete(key);
            return false;
        }
        return true;
    }

    public sweep(): void {
        this.writesSinceSweep = 0;
        this.lastSweepAt = Date.now();
        const now = Date.now();
        for (const [key, entry] of super.entries()) {
            if (isExpired(entry, now)) super.delete(key);
        }
    }
}

/** Remaining TTL in ms of a key stored in a Keyv client, `undefined` when it has none or does not exist. */
export const getRemainingTtlMs = <T>(client: Keyv<T>, key: string): number | undefined => {
    const store = client.opts.store as unknown as Map<string, KeyvEntry>;
    const entry = store?.get?.(`${client.opts.namespace}:${key}`);

    return typeof entry?.expires === 'number' ? Math.max(0, entry.expires - Date.now()) : undefined;
};

/**
 * TTL in ms to write an invalidation set with: never shorter than what the set already has left,
 * so a short-lived member cannot make the set expire before a longer-lived one. `undefined` means no expiry.
 */
export const getExtendedTtlMs = <T>(client: Keyv<T>, key: string, ttlSeconds: number): number | undefined => {
    if (!(ttlSeconds > 0)) return undefined;

    return Math.max(ttlSeconds * 1000, getRemainingTtlMs(client, key) ?? 0);
};

/**
 * Pushes back the expiry of a key that is still stored, synchronously, so it cannot bring back a value
 * deleted in the meantime. Returns whether the key was there.
 */
export const extendStoredTtl = <T>(client: Keyv<T>, key: string, ttlMs: number): boolean => {
    const store = client.opts.store as unknown as Map<string, KeyvEntry>;
    const storedKey = `${client.opts.namespace}:${key}`;
    if (!store?.has?.(storedKey)) return false;

    store.get(storedKey).expires = Date.now() + ttlMs;
    return true;
};
