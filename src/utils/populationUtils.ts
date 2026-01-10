import { Document, Model, Query } from 'mongoose';
import { getMongooseModelByName } from './mongooseUtils';
import { getCacheStrategyInstance } from './commonUtils';
import { CacheNamespaces, SpeedGoosePopulateOptions, CachedResult, TtlInheritance } from '../types/types';
import mpath from 'mpath';
import { isLeanQuery } from './queryUtils';

// Helper to normalize select fields for cache key
export const normalizeSelect = (select?: string | string[] | object): string => {
    if (!select) return '';
    if (typeof select === 'string') {
        return select.split(/\s+/).filter(Boolean).sort().join(',');
    }
    if (Array.isArray(select)) {
        return select.slice().sort().join(',');
    }
    if (typeof select === 'object') {
        return Object.keys(select).sort().join(',');
    }
    return String(select);
};

export const getDocumentCacheKey = (modelName: string, id: string, select?: string | string[] | object): string => {
    const selectKey = normalizeSelect(select);
    return selectKey
        ? `${CacheNamespaces.DOCUMENTS}:${modelName}:${id}:select:${selectKey}`
        : `${CacheNamespaces.DOCUMENTS}:${modelName}:${id}`;
};

/**
 * Calculates the final TTL for a population operation based on inheritance rules.
 */
export const calculatePopulationTtl = (
    optionTtl: number | undefined,
    contextTtl: number | undefined,
    ttlInheritance: TtlInheritance | 'fallback' | 'override' | undefined,
): number => {
    const defaultTtl = 60; // Default global TTL
    if (ttlInheritance === 'override') {
        return contextTtl ?? optionTtl ?? defaultTtl;
    }
    // Default behavior is 'fallback'
    return optionTtl ?? contextTtl ?? defaultTtl;
};

/**
 * Fetches documents from the DB for given IDs, caches them, and returns them.
 */
export const fetchAndCacheMissedDocuments = async (
    missedIds: string[],
    populatedModel: Model<any>,
    select: string | undefined | Record<string, number>,
    isLean: boolean,
    ttl: number,
): Promise<Map<string, CachedResult<unknown>>> => {
    const cacheStrategy = getCacheStrategyInstance();
    const docsFromDbQuery = populatedModel.find({ _id: { $in: missedIds } }, select);
    if (isLean) {
        docsFromDbQuery.lean();
    }
    const docsFromDb = await docsFromDbQuery.exec();

    const newDocsToCache = new Map<string, CachedResult<unknown>>();
    for (const doc of docsFromDb) {
        const key = getDocumentCacheKey(populatedModel.modelName, doc._id.toString(), select);
        const cachedDoc = isLean ? doc : doc.toObject();
        newDocsToCache.set(key, cachedDoc);
    }
    if (newDocsToCache.size > 0) {
        await cacheStrategy.setDocuments(newDocsToCache, ttl);
    }
    return newDocsToCache;
};

/**
 * Converts plain objects from cache to Mongoose documents if the query is not lean.
 */
export const hydratePopulatedData = <T extends Document>(
    data: CachedResult<T> | CachedResult<T>[],
    populatedModel: Model<T>,
    isLean: boolean,
): T | T[] | null => {
    if (isLean || !data) return data as T | T[] | null;

    const hydrate = (item: any) => (item && typeof item === 'object' ? populatedModel.hydrate(item) : item);

    return Array.isArray(data) ? data.map(hydrate) : hydrate(data);
};

/**
 * Stitches populated documents into parent documents and sets up cache relationships.
 */
export const stitchAndRelateDocuments = async <T extends Document>(
    documents: T[],
    path: string,
    populatedModel: Model<any>,
    select: string | undefined | Record<string, number>,
    docsFromCache: Map<string, CachedResult<unknown>>,
    isLean: boolean,
) => {
    const cacheStrategy = getCacheStrategyInstance();

    for (const doc of documents) {
        const ids = mpath.get(path, doc);
        const getCacheValue = (id: any) => docsFromCache.get(getDocumentCacheKey(populatedModel.modelName, id.toString(), select));
        const populatedValue = Array.isArray(ids) ? ids.map(getCacheValue).filter(Boolean) : getCacheValue(ids);

        const hydratedValue = hydratePopulatedData(populatedValue, populatedModel, isLean);
        mpath.set(path, hydratedValue, doc);

        // Update parent-child relationships for cache invalidation
        const childIds = Array.isArray(ids) ? ids : [ids];
        for (const childId of childIds.filter(Boolean)) {
            const childIdentifier = `${CacheNamespaces.RELATIONS_CHILD_TO_PARENT}:${populatedModel.modelName}:${childId}`;
            const parentIdentifier = `${doc.constructor.name}:${doc._id}`;
            await cacheStrategy.addParentToChildRelationship(childIdentifier, parentIdentifier);
        }
    }
};

/**
 * Handles caching logic for a single population option.
 */
export const handleSinglePopulation = async <T extends Document>(
    documents: T[],
    query: Query<any, any>,
    options: SpeedGoosePopulateOptions,
    contextTtl?: number,
) => {
    const cacheStrategy = getCacheStrategyInstance();
    const { path, select, ttl: optionTtl, ttlInheritance } = options;
    const lean = isLeanQuery(query);

    const ttl = calculatePopulationTtl(optionTtl, contextTtl, ttlInheritance);

    // FIX: This is the corrected logic to robustly find the referenced model name
    // for both single references (`ref: 'Model'`) and array references (`[{ ref: 'Model' }]`).
    const schemaField = query.model.schema.path(path) as any; // Use `any` to access options dynamically
    const refModelName = schemaField.options.ref ?? schemaField.options?.type?.[0]?.ref;
    if (!refModelName) return; // Path is not a valid population path.

    const populatedModel = getMongooseModelByName(refModelName);
    const idsToPopulate = [...new Set(documents.flatMap(doc => mpath.get(path, doc)))].filter(Boolean) as string[];

    if (idsToPopulate.length === 0) return;

    const cacheKeys = idsToPopulate.map(id => getDocumentCacheKey(populatedModel.modelName, id, select));
    const docsFromCache = await cacheStrategy.getDocuments(cacheKeys);
    const missedIds = idsToPopulate.filter(id => !docsFromCache.has(getDocumentCacheKey(populatedModel.modelName, id, select)));

    if (missedIds.length > 0) {
        const newDocs = await fetchAndCacheMissedDocuments(missedIds, populatedModel, select, lean, ttl);
        newDocs.forEach((value, key) => docsFromCache.set(key, value));
    }

    await stitchAndRelateDocuments(documents, path, populatedModel, select, docsFromCache, lean);
};

/**
 * Main handler for processing cached population.
 * Iterates through population options and delegates to handleSinglePopulation.
 */
export const handleCachedPopulation = async <T extends Document>(
    documents: T[],
    populateOptions: SpeedGoosePopulateOptions[],
    query: Query<any, any>,
    contextTtl?: number,
): Promise<T[]> => {
    if (!documents || documents.length === 0) return documents;

    for (const options of populateOptions) {
        await handleSinglePopulation(documents, query, options, contextTtl);
    }

    return documents;
};