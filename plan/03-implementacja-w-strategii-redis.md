
## Faza 3: Implementacja w Strategii Redis

**Plik do edycji:** `src/cachingStrategies/redisStrategy.ts`

**Cel:** Zaimplementowanie nowych, abstrakcyjnych metod z Fazy 2, wykorzystując specyficzne dla Redis komendy.

**Szczegółowe zadania:**

1.  Zaimplementuj `getDocuments` przy użyciu komendy `MGET`.
2.  Zaimplementuj `setDocuments` przy użyciu `MSET` wewnątrz `pipeline`.
3.  Zaimplementuj metody do zarządzania relacjami przy użyciu `SADD`, `SMEMBERS` i `DEL`.

**Przykład implementacji:**

```typescript
// ... importy

@staticImplements<CommonCacheStrategyStaticMethods>()
export class RedisStrategy extends CommonCacheStrategyAbstract {
    // ... istniejący kod

    public async getDocuments<T>(keys: string[]): Promise<Map<string, CachedResult<T>>> {
        const resultsMap = new Map<string, CachedResult<T>>();
        if (keys.length === 0) return resultsMap;

        const values = await this.client.mget(keys);
        values.forEach((value, index) => {
            if (value) {
                resultsMap.set(keys[index], JSON.parse(value));
            }
        });
        return resultsMap;
    }

    public async setDocuments<T>(documents: Map<string, CachedResult<T>>, ttl: number): Promise<void> {
        if (documents.size === 0) return;

        const pipeline = this.client.pipeline();
        for (const [key, value] of documents.entries()) {
            pipeline.set(key, JSON.stringify(value), 'EX', ttl);
        }
        await pipeline.exec();
    }
    
    public async addParentToChildRelationship(childIdentifier: string, parentIdentifier: string): Promise<void> {
        await this.client.sadd(childIdentifier, parentIdentifier);
    }
    
    public async getParentsOfChild(childIdentifier: string): Promise<string[]> {
        return this.client.smembers(childIdentifier);
    }
    
    public async removeChildRelationships(childIdentifier: string): Promise<void> {
        await this.client.del(childIdentifier);
    }
}
```
