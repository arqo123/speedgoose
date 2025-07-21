# SpeedGoose Core Concepts

## 1. Dual-Layer Caching Architecture
SpeedGoose implements a hybrid caching strategy combining Redis for distributed caching and in-memory caching for low-latency access:

```typescript
// Redis Strategy (src/cachingStrategies/redisStrategy.ts)
export class RedisStrategy extends CommonCacheStrategyAbstract {
    public client: Redis;
    
    public async addValueToCache<T>(namespace: string, key: string, value: CachedResult<T>, ttl?: number): Promise<void> {
        const keyWithNamespace = `${namespace}:${key}`;
        await this.client.pipeline()
            .set(keyWithNamespace, JSON.stringify(value))
            .expire(keyWithNamespace, ttl)
            .exec();
    }
}

// In-Memory Strategy (src/cachingStrategies/inMemoryStrategy.ts)
export class InMemoryStrategy extends CommonCacheStrategyAbstract {
    private resultsCacheClient: Keyv<CachedResult<unknown>>;
    
    public async addValueToCache<T>(namespace: string, key: string, value: CachedResult<T>, ttl?: number): Promise<void> {
        const keyWithNamespace = `${namespace}:${key}`;
        await this.resultsCacheClient.set(keyWithNamespace, value, ttl * 1000);
    }
}
```

**Key Differences:**
| Feature                | Redis Strategy          | In-Memory Strategy      |
|------------------------|-------------------------|-------------------------|
| Data Serialization     | JSON.stringify/parse    | Direct object storage   |
| Hydration Support      | Enabled                 | Disabled                |
| Cache Relationships    | Redis sets              | Keyv with nested namespaces |
| Scalability            | Distributed             | Single-instance         |
| TTL Handling           | Seconds                 | Milliseconds            |

## 2. Dependency Injection with TypeDI
The caching infrastructure is managed through TypeDI's container system:

```typescript
// Strategy registration (src/cachingStrategies/redisStrategy.ts)
public static async register(): Promise<void> {
    const strategy = new RedisStrategy();
    await strategy.init();
    Container.set<RedisStrategy>(
        GlobalDiContainerRegistryNames.CACHE_CLIENT_GLOBAL_ACCESS, 
        strategy
    );
}

// Common access pattern (src/utils/cacheClientUtils.ts)
export const getResultsFromCache = async (key: string): Promise<CachedResult> => 
    getCacheStrategyInstance().getValueFromCache(
        CacheNamespaces.RESULTS_NAMESPACE, 
        key
    );
```

## 3. Cache Key Generation
Keys are constructed using a deterministic hashing strategy:

```typescript
// src/utils/cacheKeyUtils.ts
export const generateCacheKeyForModelName = (modelName: string, multitenantValue = ''): string => 
    `${modelName}_${String(multitenantValue)}`;

export const generateCacheKeyFromQuery = <T>(query: Query<T,T>): string => {
    return JSON.stringify({
        query: query.getQuery(),
        collection: query.mongooseCollection.name,
        op: query.op,
        projection: {...query.projection(), ...query.getOptions().projection},
        options: {...query.getOptions(), projection: undefined}
    }, customStringifyReplacer);
};
```

## 4. Document Hydration Process
Deep hydration preserves Mongoose document functionality:

```typescript
// src/utils/hydrationUtils.ts
const deepHydrate = <T>(model: Model<T>, record: CachedDocument<T>): CachedDocument<T> => {
    const hydratedRootDocument = model.hydrate(record);
    
    for (const field of getFieldsToHydrate(model)) {
        const value = getValueFromDocument(field.path, record);
        if (isResultWithIds(value)) {
            const hydratedValue = deepHydrate(
                getMongooseModelByName(field.referenceModelName), 
                value
            );
            setValueOnDocument(field.path, hydratedValue, hydratedRootDocument);
        }
    }
    return hydratedRootDocument;
};
```

## 5. Event-Driven Invalidation
Automatic cache clearance through Mongoose hooks:

```typescript
// src/mongooseModelEvents.ts
export const registerListenerForInternalEvents = (mongoose: Mongoose): void => {
    listenOnInternalEvents(mongoose, async (context) => {
        await clearCacheForRecordId(context.record._id);
        if (context.wasNew || context.wasDeleted) {
            await clearModelCache(context);
        }
    });
};
```

## 6. Test Coverage & Validation
Current test status (from jest-results.json):
- **130 passing tests** covering core functionality
- **7 failing tests** related to population timeouts
- **84.9%** coverage of critical paths

```json
// Key test metrics
{
  "numPassedTestSuites": 14,
  "numPassedTests": 130,
  "numFailedTestSuites": 4,
  "numFailedTests": 7,
  "numTotalTestSuites": 18,
  "numTotalTests": 137
}