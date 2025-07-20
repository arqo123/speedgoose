
## Faza 1: Definicja Kontraktu (Typy i Interfejsy)

**Plik do edycji:** `src/types/types.ts` i `src/types/mongoose.ts`

**Cel:** Zdefiniowanie wszystkich nowych typów, opcji i przestrzeni nazw, które będą fundamentem dla dalszych prac. Rozszerzymy również interfejs `Query` w Mongoose.

**Szczegółowe zadania:**

1.  W `src/types/types.ts`, dodaj nowe przestrzenie nazw do enuma `CacheNamespaces`.
2.  Zdefiniuj nowy typ `SpeedGoosePopulateOptions` dla opcji przekazywanych do `.cachePopulate()`.
3.  W `src/types/mongoose.ts`, dodaj metodę `cachePopulate` do interfejsu `Query`.

**Przykład implementacji (`src/types/types.ts`):**

```typescript
// ... istniejące typy

export type SpeedGoosePopulateOptions = {
    /** The path to populate. */
    path: string;
    /** Fields to select. */
    select?: string | Record<string, number>;
    /** Optional TTL for individual populated documents. */
    ttl?: number;
    /** Controls the scope of cache invalidation when a child document changes. */
    invalidationScope?: 'parents' | 'full'; // 'parents' = tylko dokumenty rodziców, 'full' = rodzice + zapytania
};

export enum CacheNamespaces {
    // ... istniejące
    DOCUMENTS = 'doc',
    RELATIONS_CHILD_TO_PARENT = 'rel:child',
}

// ... reszta pliku
```

**Przykład implementacji (`src/types/mongoose.ts`):**

```typescript
// ... istniejące importy

declare module 'mongoose' {
    //@ts-expect-error overwriting of mongoose Query interface
    // eslint-disable-next-line @typescript-eslint/ban-types, @typescript-eslint/no-unused-vars
    interface Query<ResultType, DocType, THelpers = {}, RawDocType = DocType> extends Query<ResultType, DocType> {
        cacheQuery(params?: SpeedGooseCacheOperationParams): Promise<Query<ResultType, DocType, unknown>>;
        isCached(params?: SpeedGooseCacheOperationParams): Promise<boolean>;
        /** New method for cached population */
        cachePopulate(options: SpeedGoosePopulateOptions | SpeedGoosePopulateOptions[]): this;
        mongooseCollection: Collection;
        op: string;
    }
    // ... reszta pliku
}
```
