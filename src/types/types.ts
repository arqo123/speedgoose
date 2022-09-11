import Keyv from 'keyv';
import './mongoose'
import {Aggregate, Document, LeanDocument} from "mongoose";
import {RedisStrategy} from '../cachingStrategies/redisStrategy';
import {InMemoryStrategy} from '../cachingStrategies/inMemoryStrategy';

export type AggregationResult = Aggregate<unknown>
export type CachedDocument = Document | Document[]
export type CachedLeanDocument = LeanDocument<unknown> | LeanDocument<unknown>[]

export type CachedResult = CachedDocument | CachedLeanDocument | AggregationResult | number | string | string[] | number[]

export type SpeedGooseCacheAutoCleanerOptions = {
    /**
     *  Could be set to check if given record was deleted. Useful when records are removing by setting some deletion indicator like "deleted" : true 
     * @param {Document} record mongoose document for which event was triggered
    **/
    wasRecordDeletedCallback?: <T>(record: Document<T>) => boolean
}

export type CustomDebugger = (label: string, ...dataToLog: unknown[]) => void

export enum SpeedGooseDebuggerOperations {
    EVENTS = 'event',
    CACHE_QUERY = 'cacheQuery',
    CACHE_PIPELINE = 'cachePipeline',
    CACHE_CLEAR = 'cacheClear'
}

export type SpeedGooseConfig = {
    /** Connection string for redis containing url, credentials and port. */
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
    },
    /** Cache strategy for shared results, by default it is SharedCacheStrategies.REDIS */
    sharedCacheStrategy?: SharedCacheStrategies
}

export type SpeedGooseCacheOperationParams = {
    /** It tells to speedgoose for how long given query should exists in cache. By default is 60 seconds. Set 0 to make it disable. */
    ttl?: number;
    /** Usefull only when using multitenancy. Could be set to distinguish cache keys between tenants.*/
    multitenantValue?: string;
    /** Your custom caching key.*/
    cacheKey?: string;
}

export type SpeedGooseCacheOperationContext = SpeedGooseCacheOperationParams & {
    debug?: CustomDebugger
}

export enum MongooseDocumentEvents {
    BEFORE_SAVE = 'beforeSave',
    AFTER_REMOVE = 'afterRemove',
    AFTER_SAVE = 'afterSave',
}

export type MongooseDocumentEventsContext = {
    record?: Document,
    wasNew?: boolean;
    wasDeleted?: boolean;
    modelName?: string;
    debug?: CustomDebugger
}

export enum CacheNamespaces {
    RESULTS_NAMESPACE = 'resultsNamespace',
    HYDRATED_DOCUMENTS_NAMESPACE = 'hydratedDocumentsNamespace',
    HYDRATED_DOCUMENTS_VARIATIONS_KEY_NAMESPACE = 'hydratedDocumentsVariationsKeyNamespace',
    RECORD_RESULTS_SETS = 'recordResultsSets',
}

export enum GlobalDiContainerRegistryNames {
    CACHE_CLIENT_GLOBAL_ACCESS = 'globalCacheAccess',
    CONFIG_GLOBAL_ACCESS = 'speedGooseConfigAccess',
    MONGOOSE_GLOBAL_ACCESS = 'mongooseAccess',
    REDIS_GLOBAL_ACCESS = 'redisAccess',
    KEYV_REDIS_GLOBAL_ACCESS = 'keyvRedisAccess',
    HYDRATED_DOCUMENTS_CACHE_ACCESS = 'hydratedDocumentsCacheAccess',
    HYDRATED_DOCUMENTS_VARIATIONS_CACHE_ACCESS = 'hydratedDocumentsVariationsCacheAccess',
    GLOBAL_CACHED_SETS_QUEUE_ACCESS = 'globalCachedSetsQueueAccess',
}

export enum SpeedGooseRedisChannels {
    REMOVED_DOCUMENTS = 'speedgooseRemovedDocumentsChannel',
    SAVED_DOCUMENTS = 'speedgooseSavedDocumentsChannel',
}

export type MongooseDocumentEventCallback = (context: MongooseDocumentEventsContext) => void

export enum MongooseCountQueries {
    COUNT = 'count',
    COUNT_DOCUMENTS = 'countDocuments',
    ESTIMATED_DOCUMENTS_COUNT = 'estimatedDocumentCount'
}

export enum SharedCacheStrategies {
    REDIS = 'redis',
    IN_MEMORY = 'inMemory'
}

export type CacheStrategieTypes = RedisStrategy | InMemoryStrategy

export type CacheSetQueuedTask = {
    client: Keyv<Set<string | number>>,
    namespace: string,
    value: string | number
}