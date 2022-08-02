<div id="top"></div>

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://github.com/arqo123/mongooseCacheLayer">
    <img src="images/logo.png" alt="Logo" width="80" height="80">
  </a>

<h3 align="center">Mongoose Cache Layer</h3>
</div>



<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>



<!-- ABOUT THE PROJECT -->
## About The Project

This project is a next-level mongoose caching library which is fully written in typescript.
It's caching on two levels. Shared - with redis. And local inside memory. Supports all mongoose operations like find,findOne,count,aggregate... and others. Also supports lean queries. Why it is different? 
- It supports caching not only JSON objects in redis, but also whole Mongoose.Document instances in local memory to speed up code, and prevent unnecessary hydrations
- It has auto-clearing ability based on mongoose events. So if the query was cached for some records, and in the meantime that records changes, all cached related results will be cleared.  
- Supports custom eventing. For example you wan't to remove given results from cache, but removal logic is not based on removing documents from db but rather field based (like `deleted: true`), then you can apply a `wasRecordDeleted` callback as an option for the plugin

<p align="right">(<a href="#top">back to top</a>)</p>

<!-- GETTING STARTED -->
## Getting Started

This is an example of how you may give instructions on setting up your project locally.
To get a local copy up and running follow these simple example steps.

### Installation

1. Simple wrap your mongoose with the library (required)
```
import {applyMongooseCacheLayer} from "mongooseCacheLayer";
import mongoose from "mongoose";

applyMongooseCacheLayer(mongoose, {
  redisUri: process.env.REDIS_URI,
  redisIndex : process.env.REDIS_INDEX_DB
})
```
2. To enable auto-clearing for given schema, just add plugin to it (required)
```
import {MongooseCacheAutoCleaner} from "mongooseCacheLayer";

Schema.plugin(MongooseCacheAutoCleaner)
// additionaly you can pass options for example callback for setting record as deleted 
Schema.plugin(MongooseCacheAutoCleaner, {wasRecordDeletedCallback} )
```
  
 
<!-- USAGE EXAMPLES -->
## Usage
1. With find, count etc...

```
model.find({}).cacheQuery()
model.find({}).sort({fieldA : 1}).cacheQuery()
model.find({}).lean().cacheQuery()
```

2. With aggregation

```
model.aggregate([]).cachePipeline()
```

<p align="right">(<a href="#top">back to top</a>)</p>

<!-- ROADMAP -->
## Roadmap
- [ ] Add more examples
- [ ] Deep hydration for nested documents
- [ ] Cache-based population
- [ ] Manual cache clearing for custom keys
- [ ] Flowchart of 
- [ ] Tests

 
See the [open issues](https://github.com/github_username/repo_name/issues) for a full list of proposed features (and known issues).

<p align="right">(<a href="#top">back to top</a>)</p>


<!-- CONTRIBUTING -->
## Contributing

<p align="right">(<a href="#top">back to top</a>)</p>

<!-- LICENSE -->
## License

Distributed under the MIT License. See `LICENSE.txt` for more information.

<p align="right">(<a href="#top">back to top</a>)</p>

<!-- CONTACT -->
## Contact

<p align="right">(<a href="#top">back to top</a>)</p>

 
 
