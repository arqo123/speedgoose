import { Document, Aggregate, Query } from 'mongoose';
import { CachedDocument, DocumentWithIdAndTenantValue } from '../types/types';
import { getConfig } from './commonUtils';
import { stringifyPopulatedPaths, stringifyQueryParam } from './queryUtils';

// Mongoose internal populate/runtime-only fields that carry non-deterministic object references
// and transient state. Excluding them ensures stable, serializable cache keys.
const POPULATE_INTERNAL_KEYS = new Set(['_docs', '_childDocs', '_queryProjection', '_fullPath', '_localModel']);

const isObjectIdLike = (value: unknown): value is { toHexString: () => string } =>
    Boolean(
        value &&
        typeof value === 'object' &&
        typeof (value as { toHexString?: () => string }).toHexString === 'function' &&
        ((value as { _bsontype?: string })._bsontype === 'ObjectId' || (value as { constructor?: { name?: string } }).constructor?.name === 'ObjectId'),
    );

const normalizePopulateValue = (value: unknown): unknown => {
    if (value == null) {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map(option => normalizePopulateValue(option));
    }

    if (typeof value !== 'object') {
        return value;
    }

    return Object.entries(value as Record<string, unknown>)
        .filter(([key, nestedValue]) => !POPULATE_INTERNAL_KEYS.has(key) && typeof nestedValue !== 'function' && typeof nestedValue !== 'symbol')
        .sort(([left], [right]) => left.localeCompare(right))
        .reduce<Record<string, unknown>>((acc, [key, nestedValue]) => {
            const normalized = normalizePopulateValue(nestedValue);
            if (normalized !== undefined) {
                acc[key] = normalized;
            }
            return acc;
        }, {});
};

const normalizeForStableStringify = (value: unknown, seen: WeakSet<object>): unknown => {
    if (value === null) {
        return null;
    }

    if (value instanceof RegExp) {
        return `regex:${value.toString()}`;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (typeof value === 'bigint') {
        return value.toString();
    }

    if (isObjectIdLike(value)) {
        return `objectId:${value.toHexString()}`;
    }

    if (Array.isArray(value)) {
        return value.map(item => {
            const normalized = normalizeForStableStringify(item, seen);
            return normalized === undefined ? null : normalized;
        });
    }

    if (typeof value === 'object') {
        if (seen.has(value as object)) {
            return '[Circular]';
        }

        seen.add(value as object);
        const normalizedObject = Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .reduce<Record<string, unknown>>((acc, [key, nestedValue]) => {
                const normalized = normalizeForStableStringify(nestedValue, seen);
                if (normalized !== undefined) {
                    acc[key] = normalized;
                }
                return acc;
            }, {});
        /*
         * Intentionally remove object from "seen" after processing.
         * This keeps cache-key generation deterministic for shared object references
         * and only treats active traversal loops as circular.
         */
        seen.delete(value as object);
        return normalizedObject;
    }

    if (typeof value === 'function' || typeof value === 'symbol' || value === undefined) {
        return undefined;
    }

    return value;
};

export const stableSerialize = (value: unknown): string => JSON.stringify(normalizeForStableStringify(value, new WeakSet<object>()));

export const generateCacheKeyFromQuery = <T>(query: Query<T, T>): string =>
    stableSerialize({
        query: query.getQuery(),
        collection: query.mongooseCollection.name,
        op: query.op,
        projection: {
            ...((query.projection() as Record<string, number> | undefined) ?? {}),
            ...((query.getOptions().projection as Record<string, number> | undefined) ?? {}),
        },
        options: { ...query.getOptions(), projection: undefined, session: undefined },
        mongooseOptions: {
            lean: query?._mongooseOptions?.lean ?? null,
            populate: normalizePopulateValue(query?._mongooseOptions?.populate) ?? null,
        },
        speedGoosePopulate: normalizePopulateValue(query?._mongooseOptions?.speedGoosePopulate) ?? null,
    });

export const generateCacheKeyFromPipeline = <R>(aggregation: Aggregate<R>): string =>
    stableSerialize({
        pipeline: aggregation.pipeline(),
        collection: aggregation._model.collection.name,
        options: { ...(aggregation.options ?? {}), session: undefined },
    });

export const generateCacheKeyForSingleDocument = <T>(query: Query<T, T>, record: CachedDocument<T>): string => {
    if (!record) return '';

    if (!query.selected() && query.getPopulatedPaths().length === 0) {
        return String(record._id);
    }

    const projectionFields = stringifyQueryParam((query?.projection() as Record<string, number>) ?? {});
    const populationFields = stringifyPopulatedPaths(query?.getPopulatedPaths() ?? []);

    return `${record?._id}_${projectionFields}_${populationFields}`;
};

export const generateCacheKeyForModelName = (modelName: string, multitenantValue = ''): string => `${modelName}_${String(multitenantValue)}`;

export const generateCacheKeyForRecordAndModelName = <T>(record: Document<T> | DocumentWithIdAndTenantValue, modelName: string): string => {
    const config = getConfig();
    const multitenantKey = config?.multitenancyConfig?.multitenantKey;

    return multitenantKey ? `${modelName}_${String(record[multitenantKey])}` : modelName;
};
