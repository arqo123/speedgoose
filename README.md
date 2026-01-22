<div id="top"></div>

<!-- PROJECT LOGO -->
<br />
<div align="center">
 <img src="speedgoose.png" alt="Logo" width="180" >
 
</div>

## About The Project

[![npm version](https://img.shields.io/npm/v/speedgoose.svg?style=flat-square)](https://www.npmjs.org/package/speedgoose)
[![codecov](https://codecov.io/gh/arqo123/speedgoose/branch/master/graph/badge.svg?token=33R2CJ6I2C)](https://codecov.io/gh/arqo123/speedgoose)
[![Known Vulnerabilities](https://snyk.io//test/github/arqo123/speedgoose/badge.svg?targetFile=package.json)](https://snyk.io//test/github/arqo123/speedgoose?targetFile=package.json)
![NPM download/month](https://img.shields.io/npm/dm/speedgoose.svg)

This project is a next-level mongoose caching library that is fully written in typescript.
It's caching on two levels. Shared - with Redis. And local inside memory. Supports all mongoose operations like find,findOne, count, aggregate... and others. Also supports lean queries. Why it is different?

-   It supports caching not only JSON objects in Redis but also the whole Mongoose. Document instances in local memory to speed up code, and prevent unnecessary hydrations. Also supports full in-memory caching, without Redis.
-   It has an auto-clearing ability based on mongoose events. So if the query was cached for some records, and in the meantime, those records change, all cached-related results will be cleared.
-   It supports deep hydration, for caching not only the root document instances but also those that are populated.
-   Supports custom eventing. For example, if you want to remove given results from cache, but removal logic is not based on removing documents from DB but rather field based (like deleted: true), then you can apply a `wasRecordDeleted` callback as an option for the plugin.
-   Supports multitenancy by clearing cached results only for a related tenant.
-   It has a `cachePopulate` method that solves the N+1 problem with Mongoose population.
<p align="right">(<a href="#top">back to top</a>)</p>

## Release Note: 
For now the latests version is on top of mongoose 8.8.0 and is tagged as beta. If you're facing any issues please use version 2.0.13 - it's compatible with mongoose 7.

<!-- GETTING STARTED -->

## Getting Started

This is an example of how you may give instructions on setting up your project locally.
To get a local copy up and running follow these simple example steps.

### Installation

```console
$ npm install speedgoose
# or
$ yarn add speedgoose
```

1. Simple wrap your mongoose with the library (required)

```ts
import { applySpeedGooseCacheLayer } from 'speedgoose';
import mongoose from 'mongoose';

applySpeedGooseCacheLayer(mongoose, {
    redisUri: process.env.REDIS_URI,
});
```

2. To enable auto-clearing for a given schema, just add the plugin to it (required)

```ts
import { SpeedGooseCacheAutoCleaner } from 'speedgoose';

Schema.plugin(SpeedGooseCacheAutoCleaner);
//additionally you can pass options for example callback for setting the record as deleted
Schema.plugin(SpeedGooseCacheAutoCleaner, { wasRecordDeletedCallback });
```

<!-- USAGE EXAMPLES -->

## Usage

1. With find, count, etc...

```ts
// with findOne
const result  = await model<SomeModelType>.findOne({}).cacheQuery()
```

```ts
// with count
const result  = await model<SomeModelType>.count({age: {$gt : 25}}).cacheQuery()
```

```ts
// with sorting query
const result  = await model<SomeModelType>.find({}).sort({fieldA : 1}).cacheQuery()
```

```ts
// with lean query
const result  = await model<SomeModelType>.find({}).lean().cacheQuery()
```

2. With aggregation

```ts
const result = await model.aggregate<AggregationResultType>([]).cachePipeline()
```

3. Checking if key was set under the key. 

```ts
const isQueryCached = await model<SomeModelType>.find({}).sort({fieldA : 1}).isCached()
const isPipelineCached = await model.aggregate<AggregationResultType>([]).isCached()
```

4. With cache-based population

```ts
const result = await model.find<ResultType>({}).cachePopulate('user')
```

<p align="right">(<a href="#top">back to top</a>)</p>

<!-- Multitenancy -->

## :briefcase: Multitenancy

For enabling multitenancy, you have to pass multitenantKey into wrapper config, so it will look like

```ts
applySpeedGooseCacheLayer(mongoose, {
    redisUri: process.env.REDIS_URI,
    multitenancyConfig: {
        multitenantKey: 'tenantId',
    },
});
```

SpeedGooseCacheAutoCleaner plugin clears the cache for a given model each time when new record appears, or some record was deleted. In multitenancy, we won't clear the cache for all of the clients - as the change appears only for one tenant.
SpeedGoose will handle it for You! But to make it work, you have to follow the rules:

1. Tenant key must be in the root of mongo documents
2. You have to somehow pass tenant value while running `cacheQuery()` or `cachePipeline()`.

-   In the case of `cacheQuery()` you can simply include tenant filtering condition in the root of query, so tenantValue will be automatically set from there
    example:

```ts
const result = await model<SomeModelType>.find({
   someCondition : {$gt: 123},
   tenantId: "someTenantUniqueValue",
   ... //rest of the query
}).cacheQuery()
```

-   In other cases for `cacheQuery()` and `cachePipeline()` you have to pass tenantValue manually by passing params

```ts
/// with cachePipeline()
const result = await model.aggregate<AggregationResultType>([]).cachePipeline({ multitenantValue: 'someTenantUniqueValue' });
```

```ts
/// with cacheQuery()
const result = await model<SomeModelType>.find({}).cacheQuery({multitenantValue : 'someTenantUniqueValue'})
```

<!-- Debugging -->

## :electric_plug: Auto-cleaner Plugin

This plugin works on mongoose Document and Query/Model operations events. In the case of Document events, we already know which of the document was changed - as it was the parent of the event. But records affected by Query/Model events are predicted according to query conditions and options. Currently supported Mongoose events:

1. Deleting operations -> `findByIdAndRemove, findByIdAndDelete, findOneAndDelete, findOneAndRemove, deleteOne, deleteMany, remove`
2. Saving operations -> `updateOne, findOneAndUpdate, findByIdAndUpdate, updateMany, save, insertMany`

If anything is missing and it's worth implementing - let me know!

<!-- Debugging -->

## :bug: Debugging

For enabling debug mode, you have to pass multitenantKey into wrapper config, so it will look like

```ts
applySpeedGooseCacheLayer(mongoose, {
  redisUri: process.env.REDIS_URI,
  debugConfig?: {
        enabled?: true,
        /** Optional: An array of mongoose models to debug, if not set then the debugger will log operations for all of the models */
        debugModels?: ['yourModelName'],
        /** Optional: An array of operations to debug, if not set then the debugger will log all operations */
        debugOperations?: SpeedGooseDebuggerOperations[],
    }
})
```

 <!-- Options -->

## :wrench: Configuration and method options

#### applySpeedGooseCacheLayer(mongoose, speedgooseConfig)

```ts
    /** Connection string for Redis containing URL, credentials, and port. It's required to make cache sync working */
    redisUri?: string;
    /** Connection options for Redis. If redisOptions set, redisUri will be ignored */
    redisOptions?: string;
    /** Config for multitenancy. */
    multitenancyConfig?: {
        /** If set, then the cache will work for multitenancy. It has to be a multitenancy field indicator, that is set at the root of every MongoDB record. */
        multitenantKey: string;
    },
    /** You can pass the default TTL value for all operations, which will not have it passed as a parameter. Value is in seconds. By default is 60 seconds */
    defaultTtl?: number;
    /** If true then will perform TTL refreshing on every read. By default is disabled */
    refreshTtlOnRead?: boolean;
    /** Config for debugging mode supported with debug-js */
    debugConfig?: {
        /** When set to true, it will log all operations or operations only for enabled namespaces*/
        enabled?: boolean,
        /** An array of mongoose models to debug, if not set then the debugger will log operations for all of the models */
        debugModels?: string[],
        /** An array of operations to debug, if not set then the debugger will log all operations */
        debugOperations?: SpeedGooseDebuggerOperations[],
    /** Cache strategy for shared results, by default it is SharedCacheStrategies.REDIS
     * Available strategies: SharedCacheStrategies.REDIS and SharedCacheStrategies.IN_MEMORY */
    sharedCacheStrategy?: SharedCacheStrategies,
    /** Indicates if caching is enabled or disabled, by default is enabled */
    enabled?: boolean
    }
```

#### `cacheQuery(operationParams)` and `cachePipeline(operationParams)`

```ts
{
    /** It tells to speedgoose for how long a given query should exist in the cache. Value is in seconds. By default is 60 seconds. Set 0 to make it disabled. */
    TTL?: number;
    /** Useful only when using multitenancy. Could be set to distinguish cache keys between tenants.*/
    multitenantValue?: string;
    /** Your custom caching key.*/
    cacheKey?: string;
    /** It tells to speedgoose to refresh the ttl time when it reads from a cached results.*/
    refreshTtlOnRead?: boolean;
}
```

#### `SpeedGooseCacheAutoCleaner(...)`

```ts
{
    /**
     * Could be set to check if a given record was deleted. Useful when records are removed by setting some deletion indicator like "deleted" : true
     * @param {Document} record mongoose document for which event was triggered
    **/
    wasRecordDeletedCallback?: <T>(record: Document<T>) => boolean
}
```

#### `clearCacheForKeys(cacheKey)`

```ts
/**
 * Can be used for manually clearing the cache for a given cache key
 * @param {string} key cache key
*/
clearCacheForKeys(cacheKey: string) : Promise<void>
```

#### `clearCachedResultsForModel(modelName,tenantId)`

```ts
/**
 * Can be used for manually clearing the cache for given modelName.
 * @param {string} modelName name of registered mongoose model
 * @param {string} multitenantValue [optional] unique value of your tenant
*/
clearCachedResultsForModel(modelName: string, multitenantValue?: string) : Promise<void>
```
 

<!-- CACHE POPULATE -->

## :recycle: Cache-based Population

Speedgoose introduces a powerful `cachePopulate` method to solve the common N+1 problem in MongoDB population. Instead of making separate database queries for each populated document, `cachePopulate` leverages caching to significantly reduce database load and improve response times.

### How It Works

The `cachePopulate` method intercepts Mongoose `populate` calls and first attempts to retrieve the referenced documents from the cache. If some documents are not found in the cache, it fetches them from the database in a single, efficient query and then caches them for future use. This process is transparent to the developer and requires minimal code changes.

Here's a flowchart illustrating the logic:

```mermaid
graph TD
    A[Query with .cachePopulate()] --> B{Are populated documents in cache?}
    B -->|Yes| C[Retrieve from cache]
    B -->|No| D[Fetch from database]
    D --> E[Cache new documents]
    E --> C
    C --> F[Return populated results]
```

### Usage Examples

Using `cachePopulate` is as simple as replacing `.populate()` with `.cachePopulate()` in your queries.

**Basic Population:**

```typescript
// From
const result = await MyModel.find({}).populate('user');

// To
const result = await MyModel.find({}).cachePopulate('user');

// or 
const result = await MyModel.find({}).cachePopulate({ path: 'user' });
```

**Multiple Populations:**

You can cache multiple population paths in two ways:

```typescript
// 1) Pass a space-delimited string
const result = await MyModel.find({}).cachePopulate("user comments");

// 2) Pass an array of configuration objects
// The second approach is the best when you need to specify different options (such as field selection or deep population) for each path.
// You can read about it down below.
const result = await MyModel.find({}).cachePopulate([
    { path: 'user' },
    { path: 'comments' }
]);
```

**Selecting Specific Fields:**

Just like with Mongoose's `populate`, you can use the `select` option to specify which fields of the populated document to return.

```typescript
const result = await MyModel.find({}).cachePopulate({
    path: 'user',
    select: 'name email' // or { name: 1, email: 1 }
});
```

**Custom TTL:**

You can set a custom Time-To-Live (TTL) for the cached populated documents.

```typescript
const result = await MyModel.find({}).cachePopulate({
    path: 'user',
    ttl: 300 // 5 minutes
});
```

**TTL Inheritance:**

The `ttlInheritance` option controls how the TTL is applied when a global TTL is also configured.

*   `'fallback'` (default): The `ttl` from `cachePopulate` is used only if no global TTL is set.
*   `'override'`: The `ttl` from `cachePopulate` always takes precedence over the global TTL.

```typescript
const result = await MyModel.find({}).cachePopulate({
    path: 'user',
    ttl: 300,
    ttlInheritance: TtlInheritance.OVERRIDE
});
```

### Supported Options

The `cachePopulate` method could accept arguments in a different form:
1) Space-delimited string. For example `.cachePopulate('field1 field2')`.
2) `SpeedGoosePopulateOptions`.
3) An array of `SpeedGoosePopulateOptions`.

The `SpeedGoosePopulateOptions` object has these properties:

| Option          | Type                         | Description                                                                                                                            |
| --------------- |------------------------------| -------------------------------------------------------------------------------------------------------------------------------------- |
| `path`          | `string`                     | The field to populate.                                                                                                                 |
| `select`        | `string` or `object`         | Specifies which document fields to include or exclude.                                                                                 |
| `ttl`           | `number`                     | The Time-To-Live for the cached populated documents, in seconds.                                                                       |
| `ttlInheritance`| `'override'` or `'fallback'` | Controls how the `ttl` option interacts with a globally configured TTL. Defaults to `'fallback'`.                                      |
| `invalidationScope`| `'parents'` or `'full'`         |  Controls the scope of cache invalidation when a child document changes.                                      |

### Parent Cache Invalidation

A key feature of `cachePopulate` is its intelligent cache invalidation. When a populated document is updated or deleted, Speedgoose automatically invalidates the cache for any parent documents that reference it. This ensures that your application always serves fresh data.

For example, if a `User` document is updated, any `Article` documents that have that user populated will have their `cachePopulate` cache cleared for the `user` field. This is handled automatically by the `SpeedGooseCacheAutoCleaner` plugin.

<!-- ROADMAP -->

## :dart: Roadmap

-   [ ] Separated documentation
-   [x] Add more examples
-   [x] Deep hydration for nested documents 
-   [x] Cache-based population
-   [x] Manual cache clearing for custom keys
-   [x] Refreshing TTL on read
-   [x] Support for clustered servers 
-   [x] Flowchart of logic
-   [ ] Tests
    -   [x] commonUtils
    -   [x] debuggerUtils
    -   [x] mongooseUtils
    -   [x] queryUtils
    -   [x] cacheClientUtils
    -   [x] cacheKeyUtils
    -   [x] hydrationUtils
    -   [x] redisUtils
    -   [ ] extendAggregate
    -   [ ] extendQuery
    -   [ ] mongooseModelEvents
    -   [x] wrapper
    -   [x] inMemory caching strategy
    -   [x] Redis caching strategy
-   [x] Multitenancy (tenant field indicator) support
-   [x] Debugging mode
-   [ ] Support for more cache storage
    -   [x] In memory
    -   [ ] Memcached https://github.com/arqo123/speedgoose/issues/49

See the [open issues](https://github.com/arqo123/speedgoose/issues) for a full list of proposed features (and known issues).


<p align="right">(<a href="#top">back to top</a>)</p>

<!-- CONTRIBUTING -->

## :ticket: Contributing

Want to contribute? Great! Open a new issue or pull request with the solution for a given bug/feature. Any ideas for extending this library are more than welcome.

<p align="right">(<a href="#top">back to top</a>)</p>

<!-- Known bugs -->

## :warning: Known bugs

-   Let me know if there are any, I will resolve them fast as SpeedGoose is!
<p align="right">(<a href="#top">back to top</a>)</p>

<!-- LICENSE -->

## :heart: License

Distributed under the MIT License. See `LICENSE.txt` for more information.

<p align="right">(<a href="#top">back to top</a>)</p>
