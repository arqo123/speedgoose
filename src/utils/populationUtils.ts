
import { Document, Query } from 'mongoose';
import { getMongooseModelByName } from './mongooseUtils';
import { getCacheStrategyInstance } from './commonUtils';
import { CacheNamespaces, SpeedGoosePopulateOptions, CachedResult, SpeedGooseDebuggerOperations } from '../types/types';
import mpath from 'mpath';
import { getDebugger } from './debugUtils';
import { isLeanQuery } from './queryUtils';

// Helper to normalize select fields for cache key
function normalizeSelect(select?: string | string[] | object): string {
    if (!select) return '';
    if (typeof select === 'string') {
        // Split by space, sort, join
        return select.split(/\s+/).filter(Boolean).sort().join(',');
    }
    if (Array.isArray(select)) {
        return select.slice().sort().join(',');
    }
    if (typeof select === 'object') {
        // For mongoose projection objects: { name: 1, email: 1 }
        return Object.keys(select).sort().join(',');
    }
    return String(select);
}

export const getDocumentCacheKey = (modelName: string, id: string, select?: string | string[] | object): string => {
    const selectKey = normalizeSelect(select);
    return selectKey
        ? `${CacheNamespaces.DOCUMENTS}:${modelName}:${id}:select:${selectKey}`
        : `${CacheNamespaces.DOCUMENTS}:${modelName}:${id}`;
};

export const handleCachedPopulation = async <T extends Document>(
    documents: T[],
    populateOptions: SpeedGoosePopulateOptions[],
    query: Query<any, any>,
    contextTtl?: number,
): Promise<T[]> => {
    if (!documents || documents.length === 0) return documents;
    const cacheStrategy = getCacheStrategyInstance();

    for (const options of populateOptions) {
        const { path, select, ttl: optionTtl, ttlInheritance = 'fallback' } = options;

        // TTL inheritance logic: document > populate option > global default
        let ttl = 60; // default global TTL
        if (ttlInheritance === 'override') {
            ttl = contextTtl ?? optionTtl ?? ttl;
        } else {
            ttl = optionTtl ?? contextTtl ?? ttl;
        }
        const schemaField = query.model.schema.path(path)
        const populatedModel = getMongooseModelByName(schemaField.options.ref ?? schemaField.options?.type[0].ref);
        const idsToPopulate = [...new Set(documents.flatMap(doc => mpath.get(path, doc)))].filter(Boolean) as string[];

        const debug = getDebugger(populatedModel.modelName, SpeedGooseDebuggerOperations.CACHE_QUERY);
        debug(`Populating ${idsToPopulate.length} documents`);

        // Batch get from cache (include select in cache key)
        const cacheKeys = idsToPopulate.map(id => getDocumentCacheKey(populatedModel.modelName, id, select));
        const docsFromCache = await cacheStrategy.getDocuments(cacheKeys);

        // Identify missing IDs (include select in cache key)
        const missedIds = idsToPopulate.filter(id => !docsFromCache.has(getDocumentCacheKey(populatedModel.modelName, id, select)));

        // Fetch missing documents from DB
        if (missedIds.length > 0) {
            const docsFromDbQuery = populatedModel.find({ _id: { $in: missedIds } }, select);
            if (isLeanQuery(query)) {
                docsFromDbQuery.lean();
            }
            const docsFromDb = await docsFromDbQuery.exec();
            const newDocsToCache = new Map<string, CachedResult<unknown>>();
            for (const doc of docsFromDb) {
                const key = getDocumentCacheKey(populatedModel.modelName, doc._id.toString(), select);
                // Convert Mongoose documents to plain objects before caching
                const cachedDoc = isLeanQuery(query) ? doc : doc.toObject();
                docsFromCache.set(key, cachedDoc);
                newDocsToCache.set(key, cachedDoc);
            }
            await cacheStrategy.setDocuments(newDocsToCache, ttl);
        }

        // Stitch results and update relationships
        for (const doc of documents) {
            const ids = mpath.get(path, doc);
            let value = Array.isArray(ids)
                ? ids.map(id => docsFromCache.get(getDocumentCacheKey(populatedModel.modelName, id.toString(), select)))
                : docsFromCache.get(getDocumentCacheKey(populatedModel.modelName, ids?.toString(), select));

            // Convert cached plain objects to Mongoose documents when needed
            if (!isLeanQuery(query)) {
                if (Array.isArray(value)) {
                    //@ts-expect-error Assuming value is an array of documents
                    value = value.map(item => item && typeof item === 'object'
                        ? populatedModel.hydrate(item)
                        : item
                    );
                } else if (value && typeof value === 'object') {
                    //@ts-expect-error Assuming value is an array of documents
                    value = populatedModel.hydrate(value)
                }
            }

            mpath.set(path, value, doc);

            // Update parent-child relationships
            const childIds = Array.isArray(ids) ? ids : [ids];
            for (const childId of childIds) {
                if (!childId) continue;

                const childIdentifier = `${CacheNamespaces.RELATIONS_CHILD_TO_PARENT}:${populatedModel.modelName}:${childId}`;
                const parentIdentifier = `${doc.constructor.name}:${doc._id}`;
                await cacheStrategy.addParentToChildRelationship(childIdentifier, parentIdentifier);
            }
        }
    }

    return documents;
};