
## Faza 2: Rozszerzenie Warstwy Abstrakcji Cache

**Plik do edycji:** `src/cachingStrategies/commonCacheStrategyAbstract.ts`

**Cel:** Zaktualizowanie abstrakcyjnej klasy strategii o nowe metody wymagane do obsługi cache'u pojedynczych dokumentów i ich relacji.

**Szczegółowe zadania:**

1.  Dodaj nowe, abstrakcyjne metody, które będą musiały zaimplementować `RedisStrategy` i `InMemoryStrategy`.

**Przykład implementacji:**

```typescript
import { CachedResult } from '../types/types';

export abstract class CommonCacheStrategyAbstract {
    // ... istniejące metody

    // Nowe metody
    public abstract getDocuments<T>(keys: string[]): Promise<Map<string, CachedResult<T>>>;
    public abstract setDocuments<T>(documents: Map<string, CachedResult<T>>, ttl: number): Promise<void>;
    public abstract addParentToChildRelationship(childIdentifier: string, parentIdentifier: string): Promise<void>;
    public abstract getParentsOfChild(childIdentifier: string): Promise<string[]>;
    public abstract removeChildRelationships(childIdentifier: string): Promise<void>;

    public isHydrationEnabled(): boolean {
        return true;
    }
}

// ... reszta pliku
```
