import Keyv from 'keyv';
import './mongoose';
import { Aggregate, Document, ObjectId } from 'mongoose';
import { RedisStrategy } from '../cachingStrategies/redisStrategy';
import { InMemoryStrategy } from '../cachingStrategies/inMemoryStrategy';
import { RedisOptions } from 'ioredis';

export type AggregationResult = Aggregate<unknown, unknown>;
export type CachedDocument<T> = Document<string | ObjectId> & T;
export type CachedLeanDocument<T> = T & { _id: ObjectId | string };
export type DocumentWithIdAndTenantValue = { _id: string; [tenantId: string]: string };

export type CachedResult<T = void> = CachedDocument<T> | CachedLeanDocument<T> | CachedDocument<T>[] | CachedLeanDocument<T>[] | AggregationResult | number | string | string[] | number[] | Record<string, unknown>;

export type SpeedGooseCacheAutoCleanerOptions = {
    /**
     *  Could be set to check if given record was deleted. Useful when records are removing by setting some deletion indicator like "deleted" : true
     * @param {Document} record mongoose document for which event was triggered
     **/
    wasRecordDeletedCallback?: <T>(record: Document<T>) => boolean;
};

export type CustomDebugger = (label?: string, ...dataToLog: unknown[]) => void;

export enum TtlInheritance {
    FALLBACK = 'fallback',
    OVERRIDE = 'override'
}

export enum SpeedGooseDebuggerOperations {
    EVENTS = 'event',
    CACHE_QUERY = 'cacheQuery',
    CACHE_PIPELINE = 'cachePipeline',
    CACHE_CLEAR = 'cacheClear',
}

export type SpeedGooseConfig = {
    /** Connection string for redis containing url, credentials and port. */
    redisUri?: string;
    /** Connection options for redis. */
    redisOptions?: RedisOptions;
    /** Config for multitenancy. */
    multitenancyConfig?: {
        /** If set, then cache will working for multitenancy. It has to be multitenancy field indicator, that is set in the root of every mongodb record. */
        multitenantKey: string;
    };
    /** You can pass default TTL value for all operations, which will not have it passed as a parameter. By default is 60 seconds */
    defaultTtl?: number;
    /** If true then will perform TTL refreshing on every read. By default is disabled */
    refreshTtlOnRead?: boolean;
    /** Config for debugging mode supported with debug-js */
    debugConfig?: {
        /** When set to true, it will log all operations or operations only for enabled namespaces*/
        enabled?: boolean;
        /** An array of mongoose models to debug, if not set then debugger will log operations for all of the models */
        debugModels?: string[];
        /** An array of operations to debug, if not set then debugger will log all operations */
        debugOperations?: SpeedGooseDebuggerOperations[];
    };
    /** Cache strategy for shared results, by default it is SharedCacheStrategies.REDIS */
    sharedCacheStrategy?: SharedCacheStrategies;
    /** Indicates if caching is enabled or disabled, by default is enabled */
    enabled?: boolean;
    /** Maximum number of parent records to process in cache invalidation batches */
    cacheParentLimit?: number;
};

export type SpeedGooseCacheOperationParams = {
    /** It tells to speedgoose for how long given query should exists in cache. By default is 60 seconds. Set 0 to make it disable. */
    ttl?: number;
    /** Useful only when using multitenancy. Could be set to distinguish cache keys between tenants.*/
    multitenantValue?: string;
    /** Your custom caching key.*/
    cacheKey?: string;
    /** It tells to speedgoose to refresh the ttl time when it reads from a cached results.*/
    refreshTtlOnRead?: boolean;
};

export type SpeedGooseCacheOperationContext = SpeedGooseCacheOperationParams & {
    debug?: CustomDebugger;
};

export enum MongooseDocumentEvents {
    SINGLE_DOCUMENT_CHANGED = 'singleDocumentChanged',
    MANY_DOCUMENTS_CHANGED = 'manyDocumentsChanged',
}

export type MongooseDocumentEventsContext = {
    record?: Document & { _id: string } | DocumentWithIdAndTenantValue;
    wasNew?: boolean;
    wasDeleted?: boolean;
    modelName?: string;
    debug?: CustomDebugger;
};

export type MongooseManyObjectOperationEventContext = {
    records: DocumentWithIdAndTenantValue[];
    modelName?: string;
    wasDeleted?: boolean;
    debug?: CustomDebugger;
};

export type MongooseInternalEventContext = MongooseDocumentEventsContext | MongooseManyObjectOperationEventContext;

export type SpeedGoosePopulateOptions = {
    /** The path to populate. */
    path: string;
    /** Fields to select. */
    select?: string | Record<string, number>;
    /** Optional TTL for individual populated documents. */
    ttl?: number;
    /** Controls TTL inheritance behavior */
    ttlInheritance?: TtlInheritance | 'fallback' | 'override'; // union type for backward compatibility
    /** Controls the scope of cache invalidation when a child document changes. */
    invalidationScope?: 'parents' | 'full'; // 'parents' = tylko dokumenty rodziców, 'full' = rodzice + zapytania
};

export enum CacheNamespaces {
    RESULTS_NAMESPACE = 'resultsNamespace',
    HYDRATED_DOCUMENTS_NAMESPACE = 'hydratedDocumentsNamespace',
    HYDRATED_DOCUMENTS_VARIATIONS_KEY_NAMESPACE = 'hydratedDocumentsVariationsKeyNamespace',
    RECORD_RESULTS_SETS = 'recordResultsSets',
    DOCUMENTS = 'doc',
    RELATIONS_CHILD_TO_PARENT = 'rel:child',
}

export enum GlobalDiContainerRegistryNames {
    CACHE_CLIENT_GLOBAL_ACCESS = 'globalCacheAccess',
    CONFIG_GLOBAL_ACCESS = 'speedGooseConfigAccess',
    MONGOOSE_GLOBAL_ACCESS = 'mongooseAccess',
    REDIS_GLOBAL_ACCESS = 'redisAccess',
    REDIS_LISTENER_GLOBAL_ACCESS = 'redisListenerAccess',
    KEYV_REDIS_GLOBAL_ACCESS = 'keyvRedisAccess',
    HYDRATED_DOCUMENTS_CACHE_ACCESS = 'hydratedDocumentsCacheAccess',
    HYDRATED_DOCUMENTS_VARIATIONS_CACHE_ACCESS = 'hydratedDocumentsVariationsCacheAccess',
    GLOBAL_CACHED_SETS_QUEUE_ACCESS = 'globalCachedSetsQueueAccess',
    GLOBAL_REFRESH_TTL_SETS_QUEUE_ACCESS = 'globalResfeshTtlSetsQueueAccess',
    GLOBAL_REFRESH_TTL_QUEUE_ACCESS = 'globalResfeshTtlsQueueAccess',
}

export enum SpeedGooseRedisChannels {
    RECORDS_CHANGED = 'speedgooseRecordsChangedChannel',
}

export type MongooseDocumentEventCallback = (context: MongooseDocumentEventsContext) => void;

export enum MongooseCountQueries {
    COUNT = 'count',
    COUNT_DOCUMENTS = 'countDocuments',
    ESTIMATED_DOCUMENTS_COUNT = 'estimatedDocumentCount',
}

export enum MongooseSpecialQueries {
    DISTINCT = 'distinct',
}

export enum SharedCacheStrategies {
    REDIS = 'redis',
    IN_MEMORY = 'inMemory',
}

export type CacheStrategiesTypes = RedisStrategy | InMemoryStrategy;

export type CacheSetQueuedTask = {
    client: Keyv<Set<string | number>>;
    namespace: string;
    value: string | number;
};

export type RefreshTtlQueuedTask = {
    key: string;
    ttl?: number;
    value?: CachedResult<unknown>;
};