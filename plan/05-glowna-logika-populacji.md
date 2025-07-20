
## Faza 5: Gówna Logika Populacji

**Nowy plik:** `src/utils/populationUtils.ts`

**Cel:** Stworzenie centralnego modułu odpowiedzialnego za orkiestrację procesu populacji z cache.

**Szczegółowe zadania:**

1.  Stwórz funkcję `handleCachedPopulation`, która przyjmuje dokumenty i opcje populacji.
2.  Zaimplementuj logikę pobierania, cachowania i "zszywania" spopulowanych danych.

**Przykład implementacji:**

```typescript
import { Document, Model } from 'mongoose';
import { getMongooseModelByName } from './mongooseUtils';
import { getCacheStrategyInstance } from './commonUtils';
import { CacheNamespaces, SpeedGoosePopulateOptions, CachedDocument, CachedResult } from '../types/types';
import mpath from 'mpath';

// Helper do generowania kluczy
const getDocumentCacheKey = (modelName: string, id: string) => `${CacheNamespaces.DOCUMENTS}:${modelName}:${id}`;

// Główna funkcja
export const handleCachedPopulation = async <T extends Document>(
    documents: T[],
    populateOptions: SpeedGoosePopulateOptions[],
    // ... inne kontekstowe parametry np. TTL
): Promise<T[]> => {
    if (!documents || documents.length === 0) return documents;

    const cacheStrategy = getCacheStrategyInstance();

    for (const options of populateOptions) {
        const { path, select, ttl: optionTtl } = options;
        const ttl = optionTtl ?? 60;
        // Logika dziedziczenia TTL:
        // 1. document TTL > populate option TTL > global default
        // 2. Możliwość konfiguracji poprzez ttlInheritance: 'override' | 'fallback'

        const populatedModel = getMongooseModelByName(documents[0].schema.path(path).options.ref);
        const idsToPopulate = [...new Set(documents.flatMap(doc => mpath.get(path, doc)))].filter(Boolean);
        
        // Dodanie metryk
        debugUtils.recordMetric('population_ids_count', idsToPopulate.length);

        // 1. Masowe pobranie z cache
        const cacheKeys = idsToPopulate.map(id => getDocumentCacheKey(populatedModel.modelName, id.toString()));
        const docsFromCache = await cacheStrategy.getDocuments(cacheKeys);

        // 2. Identyfikacja braków
        const missedIds = idsToPopulate.filter(id => !docsFromCache.has(getDocumentCacheKey(populatedModel.modelName, id.toString())));

        // 3. Pobranie braków z DB
        if (missedIds.length > 0) {
            const docsFromDb = await populatedModel.find({ _id: { $in: missedIds } }, select).lean();
            const newDocsToCache = new Map<string, CachedResult<unknown>>();
            docsFromDb.forEach(doc => {
                const key = getDocumentCacheKey(populatedModel.modelName, doc._id.toString());
                docsFromCache.set(key, doc);
                newDocsToCache.set(key, doc);
            });
            // 4. Zapisanie nowo pobranych w cache
            await cacheStrategy.setDocuments(newDocsToCache, ttl);
        }

        // 5. "Zszywanie" wyników i aktualizacja relacji
        documents.forEach(doc => {
            const ids = mpath.get(path, doc);
            const value = Array.isArray(ids) ?
                ids.map(id => {
                    const key = getDocumentCacheKey(populatedModel.modelName, id.toString());
                    return docsFromCache.get(key);
                }) :
                docsFromCache.get(getDocumentCacheKey(populatedModel.modelName, ids.toString()));
            
            mpath.set(path, value, doc);
            
            // Aktualizacja relacji
            const childIds = Array.isArray(ids) ? ids : [ids];
            childIds.forEach(childId => {
                if (!childId) return;
                const childIdentifier = `${CacheNamespaces.RELATIONS_CHILD_TO_PARENT}:${populatedModel.modelName}:${childId}`;
                const parentIdentifier = `${doc.constructor.modelName}:${doc._id}`;
                cacheStrategy.addParentToChildRelationship(childIdentifier, parentIdentifier);
            });
        });
    }

    return documents;
};
```
