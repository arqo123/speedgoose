<div id="top"></div>

<!-- PROJECT LOGO -->
<br />
<div align="center">
 <img src="speedgoose.png" alt="Logo" width="180" >
 
</div>

## About The Project

[![Node.js CI](https://github.com/arqo123/speedgoose/workflows/Node.js%20CI/badge.svg)](https://github.com/arqo123/speedgoose/actions?query=workflow:"Node.js+CI")
[![Code Grade](https://api.codiga.io/project/34556/status/svg)](https://www.codiga.io)
[![Code Quality](https://api.codiga.io/project/34556/score/svg)](https://www.codiga.io)
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
<p align="right">(<a href="#top">back to top</a>)</p>

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
const result = await model.aggregate<AggregationResultType>([]).cachePipeline();
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
    /** Config for multitenancy. */
    multitenancyConfig?: {
        /** If set, then the cache will work for multitenancy. It has to be a multitenancy field indicator, that is set at the root of every MongoDB record. */
        multitenantKey: string;
    },
    /** You can pass the default TTL value for all operations, which will not have it passed as a parameter. By default is 60 seconds */
    defaultTtl?: number;
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
    /** It tells to speedgoose for how long a given query should exist in the cache. By default is 60 seconds. Set 0 to make it disabled. */
    TTL?: number;
    /** Useful only when using multitenancy. Could be set to distinguish cache keys between tenants.*/
    multitenantValue?: string;
    /** Your custom caching key.*/
    cacheKey?: string;
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

<!-- ROADMAP -->

## :dart: Roadmap

-   [ ] Separated documentation
-   [ ] Add more examples
-   [x] Deep hydration for nested documents [BETA]
-   [ ] Cache-based population
-   [x] Manual cache clearing for custom keys
-   [x] Support for clustered servers [BETA]
-   [ ] Flowchart of logic
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
    -   [ ] Memcached

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
