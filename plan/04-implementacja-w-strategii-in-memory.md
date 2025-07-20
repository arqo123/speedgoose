
## Faza 4: Implementacja w Strategii In-Memory

**Plik do edycji:** `src/cachingStrategies/inMemoryStrategy.ts`

**Cel:** Zaimplementowanie nowych metod dla strategii in-memory, używając obiektów `Map` i `Set`.

**Szczegółowe zadania:**

1.  Dodaj nowe pola w klasie: `documentsCacheClient: Keyv<CachedResult<unknown>>` i `relationsCacheClient: Keyv<Set<string>>`.
2.  Zainicjuj je w `setClients()`.
3.  Zaimplementuj nowe metody, operując na tych klientach `Keyv`.

**Przykład implementacji:**

```typescript
// ... importy

@staticImplements<CommonCacheStrategyStaticMethods>()
export class InMemoryStrategy extends CommonCacheStrategyAbstract {
    // ... istniejące pola
    private documentsCacheClient: Keyv<CachedResult<unknown>>;
    private relationsCacheClient: Keyv<Set<string>>;

    // ... istniejące metody

    private setClients(): void {
        // ... istniejąca inicjalizacja
        this.documentsCacheClient = createInMemoryCacheClientWithNamespace(
            CacheNamespaces.DOCUMENTS,
            { maxSize: 10000 }  // Ograniczenie rozmiaru cache
        );
        this.relationsCacheClient = createInMemoryCacheClientWithNamespace(
            CacheNamespaces.RELATIONS_CHILD_TO_PARENT,
            { maxSize: 50000 }  // Ograniczenie rozmiaru cache
        );
    }

    public async getDocuments<T>(keys: string[]): Promise<Map<string, CachedResult<T>>> {
        const resultsMap = new Map<string, CachedResult<T>>();
        const promises = keys.map(async key => {
            const value = await this.documentsCacheClient.get(key);
            if (value) {
                resultsMap.set(key, value as CachedResult<T>);
            }
        });
        await Promise.all(promises);
        return resultsMap;
    }

    public async setDocuments<T>(documents: Map<string, CachedResult<T>>, ttl: number): Promise<void> {
        const promises = [];
        for (const [key, value] of documents.entries()) {
            promises.push(this.documentsCacheClient.set(key, value, ttl * 1000));
        }
        await Promise.all(promises);
    }

    public async addParentToChildRelationship(childIdentifier: string, parentIdentifier: string): Promise<void> {
        const parents = (await this.relationsCacheClient.get(childIdentifier)) || new Set<string>();
        parents.add(parentIdentifier);
        await this.relationsCacheClient.set(childIdentifier, parents);
    }

    public async getParentsOfChild(childIdentifier: string): Promise<string[]> {
        const parents = await this.relationsCacheClient.get(childIdentifier);
        return parents ? Array.from(parents) : [];
    }
    
    public async removeChildRelationships(childIdentifier: string): Promise<void> {
        await this.relationsCacheClient.delete(childIdentifier);
    }
}
```
