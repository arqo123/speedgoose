<div id="top"></div>

<!-- PROJECT LOGO -->
<br />
<div align="center">
 <img src="speedgoose.png" alt="Logo" width="180" >
 
</div> 
<!-- ABOUT THE PROJECT -->

## About The Project

This project is a next-level mongoose caching library which is fully written in typescript.
It's caching on two levels. Shared - with redis. And local inside memory. Supports all mongoose operations like find,findOne,count,aggregate... and others. Also supports lean queries. Why it is different? 
- It supports caching not only JSON objects in redis, but also whole Mongoose.Document instances in local memory to speed up code, and prevent unnecessary hydrations. Also supports full in-memory caching, without redis.
- It has auto-clearing ability based on mongoose events. So if the query was cached for some records, and in the meantime that records changes, all cached related results will be cleared. 
- It supports deep hydration, for caching not only the root document instances, but also those that are populated.   
- Supports custom eventing. For example you wan't to remove given results from cache, but removal logic is not based on removing documents from db but rather field based (like `deleted: true`), then you can apply a `wasRecordDeleted` callback as an option for the plugin.
- Supports multitenancy by clearing cached results only for related tenant.
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
import {applySpeedGooseCacheLayer} from "speedgoose";
import mongoose from "mongoose";

applySpeedGooseCacheLayer(mongoose, {
  redisUri: process.env.REDIS_URI
})
```
2. To enable auto-clearing for given schema, just add plugin to it (required)
```ts
import {SpeedGooseCacheAutoCleaner} from "speedgoose";

Schema.plugin(SpeedGooseCacheAutoCleaner)
// additionaly you can pass options for example callback for setting record as deleted 
Schema.plugin(SpeedGooseCacheAutoCleaner, {wasRecordDeletedCallback} )
```
  
 
<!-- USAGE EXAMPLES -->
## Usage
1. With find, count etc...

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

<p align="right">(<a href="#top">back to top</a>)</p>

<!-- Multitenancy -->
## :briefcase: Multitenancy
  For enabling multitenancy, you have to pass multitenantKey into wrapper config, so it will looks like
```ts
applySpeedGooseCacheLayer(mongoose, {
  redisUri: process.env.REDIS_URI,
  multitenancyConfig: {
    multitenantKey: 'tenantId'
}
})
```
 
SpeedGooseCacheAutoCleaner plugin clears cache for given model each time when new record appears, or some record was deleted. In multitenancy we wan't clear cache for all of the clients - as the change appear only for one tenant. 
SpeeGoose will handle it for You! But to make it work, you have to follow the rules:
1. Tenant key must be in root of mongo documents
2. You have to somehow pass tenant value while running ```cacheQuery()``` or ```cachePipeline()```.
 - In case of ```cacheQuery()``` you can simply include tenant filtering condition in the root of query, so tenantValue will be automaticly set from there
 example: 
 ```ts
const result = await model<SomeModelType>.find({
    someCondition : {$gt: 123},
    tenantId: "someTenantUniqueValue",
    ... //rest of the query
 }).cacheQuery()
 ```
 - In other cases for ```cacheQuery()``` and ```cachePipeline()``` you have to pass tenantValue manualy by passing params 
```ts
/// with cachePipeline()
const result = await model.aggregate<AggregationResultType>([]).cachePipeline({multitenantValue : 'someTenantUniqueValue'})  
 ```
 
 ```ts
 /// with cacheQuery()
 const result = await model<SomeModelType>.find({}).cacheQuery({multitenantValue : 'someTenantUniqueValue'})
 ```

<!-- Debugging -->
## :bug: Debugging
  For enabling debug mode, you have to pass multitenantKey into wrapper config, so it will looks like
```ts
applySpeedGooseCacheLayer(mongoose, {
  redisUri: process.env.REDIS_URI,
  debugConfig?: {
        enabled?: true,
        /** Optional: An array of mongoose models to debug, if not set then debugger will log operations for all of the models */
        debugModels?: ['yourModelName'],
        /** Optional: An array of operations to debug, if not set then debugger will log all operations */
        debugOperations?: SpeedGooseDebuggerOperations[],
    }
})
```


 <!-- Options -->
## :wrench: Configuration and method options

#### applySpeedGooseCacheLayer(mongoose, speedgooseConfig)
```ts
    /** Connection string for redis containing url, credentials and port. It's required to make cache sync working */
    redisUri?: string;
    /** Config for multitenancy. */
    multitenancyConfig?: {
        /** If set, then cache will working for multitenancy. It has to be multitenancy field indicator, that is set in the root of every mongodb record. */
        multitenantKey: string;
    },
    /** You can pass default ttl value for all operations, which will not have it passed as a parameter. By default is 60 seconds */
    defaultTtl?: number;
    /** Config for debugging mode supported with debug-js */
    debugConfig?: {
        /** When set to true, it will log all operations or operations only for enabled namespaces*/
        enabled?: boolean,
        /** An array of mongoose models to debug, if not set then debugger will log operations for all of the models */
        debugModels?: string[],
        /** An array of operations to debug, if not set then debugger will log all operations */
        debugOperations?: SpeedGooseDebuggerOperations[],
    /** Cache strategy for shared results, by default it is SharedCacheStrategies.REDIS 
     * Avaliable strategies: SharedCacheStrategies.REDIS and SharedCacheStrategies.IN_MEMORY */
    sharedCacheStrategy?: SharedCacheStrategies  
    }
```
#### ```cacheQuery(operationParams)``` and ```cachePipeline(operationParams)```
```ts
{ 
    /** It tells to speedgoose for how long given query should exists in cache. By default is 60 seconds. Set 0 to make it disable. */
    ttl?: number;
    /** Usefull only when using multitenancy. Could be set to distinguish cache keys between tenants.*/
    multitenantValue?: string;
    /** Your custom caching key.*/
    cacheKey?: string;
}
```
#### ```SpeedGooseCacheAutoCleaner(...)``` 
```ts
{
    /**
     * Could be set to check if given record was deleted. Useful when records are removing by setting some deletion indicator like "deleted" : true 
     * @param {Document} record mongoose document for which event was triggered
    **/
    wasRecordDeletedCallback?: <T>(record: Document<T>) => boolean
}
```
#### ```clearCacheForKeys(cacheKey)``` 
```ts
/** 
 * Can be used for manually clearing cache for given cache key
 * @param {string} key cache key
*/
clearCacheForKeys(cacheKey: string) : Promise<void>
```
#### ```clearCachedResultsForModel(modelName,tenantId)``` 
```ts
/** 
 * Can be used for manually clearing cache for given modelName. 
 * @param {string} modelName name of registerd mongoose model
 * @param {string} multitenantValue [optional] unique value of your tenant
*/
clearCachedResultsForModel(modelName: string, multitenantValue?: string) : Promise<void>
```


<!-- ROADMAP -->
## :dart: Roadmap
- [ ] Separated documentation
- [ ] Add more examples
- [X] Deep hydration for nested documents [BETA]
- [ ] Cache-based population
- [X] Manual cache clearing for custom keys
- [X] Support for clustered servers [BETA]
- [ ] Flowchart of logic
- [ ] Tests
     - [X] commonUtils
     - [X] debuggerUtils
     - [X] mongooseUtils
     - [X] queryUtils
     - [ ] cacheClientUtils
     - [ ] cacheKeyUtils
     - [ ] hydrationUtils
     - [ ] redisUtils
     - [ ] extendAggregate
     - [ ] extendQuery
     - [ ] mongooseModelEvents
     - [X] wrapper
     - [ ] inMemory caching strategy
     - [ ] redis caching strategy
- [X] Multitenancy (tenant field indicator) support
- [X] Debugging mode
- [ ] Support for more cache storages
     - [X] In memory 
     - [ ] Memcached


See the [open issues](https://github.com/arqo123/speedgoose/issues) for a full list of proposed features (and known issues).

<p align="right">(<a href="#top">back to top</a>)</p>


<!-- CONTRIBUTING -->
## :ticket: Contributing
Want to contribute? Great! Open new issue or pull request with the solution for given bug/feature. Any ideas for extending this library are more then wellcome.
<p align="right">(<a href="#top">back to top</a>)</p>

<!-- Known bugs -->
## :warning: Known bugs
- They might be some problems with timings between events, but only when running server in cluster mode. Cache sync was done with redis Pub/Sub, but i'm not 100% sure if it will work in every case. 
- Let me know if there are any, I will resolve them fast as SpeedGoose is! 
<p align="right">(<a href="#top">back to top</a>)</p>

<!-- LICENSE -->
## :heart: License

Distributed under the MIT License. See `LICENSE.txt` for more information.

<p align="right">(<a href="#top">back to top</a>)</p>

