
# Analysis of Cache Invalidation Logic for Populated Documents

## The Problem

The current implementation of the cache auto-cleaner fails to invalidate the cache of documents with populated fields when the populated document is updated via a query-based method (e.g., `updateOne`, `findOneAndUpdate`).

The provided test case `should invalidate parent document cache on child update` accurately demonstrates this issue. It updates a `parent` document using `UserModel.updateOne()` and then observes that a `child` document, which has the `parent` populated, still holds the old, stale data in its cache.

## Root Cause Analysis

The cache invalidation logic is handled in `src/plugin/SpeedGooseCacheAutoCleaner.ts`, which sets up Mongoose middleware hooks. The logic is split based on the type of database operation:

1.  **Document-based Operations** (e.g., `doc.save()`, `doc.remove()`): The listeners for these operations, specifically the `pre('save', ...)` and `post(/deleteOne/, ...)` hooks, correctly call the `clearParentCache()` function. This function is designed to find and invalidate cache entries for other documents that populate the document being modified.

2.  **Query-based Operations** (e.g., `Model.updateOne()`, `Model.findOneAndUpdate()`): The listener for these operations, `schema.pre([...MONGOOSE_UPDATE_ONE_ACTIONS], ...)` in `appendQueryBasedListeners`, identifies the document being updated and broadcasts a general `RECORDS_CHANGED` event. 

**The critical flaw is that this query-based hook never calls `clearParentCache()`.**

As a result, when a document is updated via `updateOne`, the system invalidates the cache for that specific document, but it fails to invalidate the cache for any other documents that depend on it through population. This leads to stale data being served from the cache.

## Recommended Solution

To resolve this issue, the `clearParentCache()` function must be invoked within the `pre` hook for query-based update operations. 

Specifically, inside the `appendQueryBasedListeners` function in `src/plugin/SpeedGooseCacheAutoCleaner.ts`, after retrieving the `updatedRecord`, a call to `clearParentCache(updatedRecord)` should be added. This will ensure that whenever a document is updated through methods like `updateOne` or `findOneAndUpdate`, the cache for any parent documents that populate it is correctly invalidated.
