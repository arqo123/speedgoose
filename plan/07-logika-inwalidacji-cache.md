
## Faza 7: Logika Inwalidacji Cache

**Plik do edycji:** `src/plugin/SpeedGooseCacheAutoCleaner.ts` i `src/utils/cacheClientUtils.ts`

**Cel:** Rozszerzenie istniejącego mechanizmu inwalidacji o czyszczenie cache'u rodziców, gdy dziecko ulega zmianie, z zabezpieczeniem przed cyklami.

**Szczegółowe zadania:**

1.  W `SpeedGooseCacheAutoCleaner.ts`, w hookach (`pre('save')`, etc.), dodać wywołanie nowej funkcji `clearParentCache(this)`.
2.  W `cacheClientUtils.ts`, stworzyć funkcję `clearParentCache`.

**Przykład implementacji (`SpeedGooseCacheAutoCleaner.ts`):**

```typescript
// Wewnątrz hooka, np. schema.pre('save', ...)
// ... po istniejącej logice
import { clearParentCache } from '../utils/cacheClientUtils';

// ...
    // Po istniejącej logice emitowania eventu
    await clearParentCache(this);
// ...
```

**Przykład implementacji (`src/utils/cacheClientUtils.ts`):**

```typescript
// ... importy

export const clearParentCache = async (doc: Document, processedIds = new Set<string>(), depth = 0): Promise<void> => {
    const MAX_DEPTH = 10; // Zabezpieczenie przed nieskończoną rekursją
    if (depth > MAX_DEPTH) return;
    
    const docIdentifier = `${doc.constructor.modelName}:${doc._id}`;
    if (processedIds.has(docIdentifier)) {
        return;
    }
    processedIds.add(docIdentifier);
    
    // Dodanie metryk
    debugUtils.recordMetric('invalidation_depth', depth);

    const cacheStrategy = getCacheStrategyInstance();
    const childIdentifier = `${CacheNamespaces.RELATIONS_CHILD_TO_PARENT}:${doc.constructor.modelName}:${doc._id}`;
    
    const parentIdentifiers = await cacheStrategy.getParentsOfChild(childIdentifier);
    
    if (parentIdentifiers.length > 0) {
        logCacheClear(`Invalidating ${parentIdentifiers.length} parents for child`, docIdentifier);

        // Batch processing for concurrency control
        const BATCH_SIZE = 50;
        for (let i = 0; i < parentIdentifiers.length; i += BATCH_SIZE) {
            const batch = parentIdentifiers.slice(i, i + BATCH_SIZE);
            const promises = batch.map(async parentIdWithModel => {
                const [modelName, id] = parentIdWithModel.split(':');
                const parentModel = getMongooseModelByName(modelName);
                if (parentModel) {
                    const parentDoc = await parentModel.findById(id).lean();
                    if(parentDoc) {
                        await clearCacheForRecordId(id);
                        await clearParentCache(parentDoc, processedIds, depth + 1);
                    }
                }
            });
            await Promise.all(promises);
        }
    }

    // Usunięcie starych relacji po ich przetworzeniu
    await cacheStrategy.removeChildRelationships(childIdentifier);
};
```
