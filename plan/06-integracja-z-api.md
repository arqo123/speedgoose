
## Faza 6: Integracja z API (`Query` i `exec`)

**Pliki do edycji:** `src/extendQuery.ts` i `src/wrapper.ts`

**Cel:** Podpięcie nowej logiki pod łańcuch `Query` Mongoose, poprzez dodanie metody `.cachePopulate()` i owinięcie metody `.exec()`.

**Szczegółowe zadania:**

1.  W `extendQuery.ts`, dodać `cachePopulate` do prototypu `Query`.
2.  W `wrapper.ts`, w `applySpeedGooseCacheLayer`, owinąć `Query.prototype.exec`.

**Przykład implementacji (`extendQuery.ts`):**

```typescript
// ... w addCachingToQuery

    // ... istniejące metody

    mongoose.Query.prototype.cachePopulate = function (options: SpeedGoosePopulateOptions | SpeedGoosePopulateOptions[]): this {
        if (!this._mongooseOptions.speedGoosePopulate) {
            this._mongooseOptions.speedGoosePopulate = [];
        }
        const opts = Array.isArray(options) ? options : [options];
        this._mongooseOptions.speedGoosePopulate.push(...opts);
        return this;
    };
```

**Przykład implementacji (`wrapper.ts`):**

```typescript
// ... na końcu pliku applySpeedGooseCacheLayer
import { handleCachedPopulation } from './utils/populationUtils';

export const applySpeedGooseCacheLayer = async (mongoose: Mongoose, config: SpeedGooseConfig): Promise<void> => {
    // ... cały istniejący kod inicjalizacji

    // Owinięcie `exec`
    const originalExec = mongoose.Query.prototype.exec;
    mongoose.Query.prototype.exec = function (...args) {
        // @ts-ignore
        const populateOptions = this._mongooseOptions.speedGoosePopulate;

        if (!populateOptions || populateOptions.length === 0) {
            return originalExec.apply(this, args);
        }

        // `this` jest instancją Query, która ma `cacheQuery` i inne.
        // Najpierw wykonujemy oryginalne zapytanie (lub z `cacheQuery`)
        return originalExec.apply(this, args).then(documents => {
            if (!documents) return documents;
            // Przekazujemy dokumenty do naszej logiki populacji
            return handleCachedPopulation(Array.isArray(documents) ? documents : [documents], populateOptions)
                .then(populatedDocs => (Array.isArray(documents) ? populatedDocs : populatedDocs[0]));
        });
    };
};
```
