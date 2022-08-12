import './mongoose'
import {Document} from "mongoose";
import Keyv from "keyv";

export type AggregationResult = unknown

export type CachedDocument = Document | Document[]

export type CachedResult = CachedDocument | AggregationResult | number

export type CacheOptions = {namespace: string, store: any}

export type SpeedGooseCacheAutoCleanerOptions = {
    /**
     *  Could be set to check if given record was deleted. Useful when records are removing by setting some deletion indicator like "deleted" : true 
     * @param {Document} record mongoose document for which event was triggered
    **/
    wasRecordDeletedCallback?: <T>(record: Document<T>) => boolean
}

export type SpeedGooseConfig = {
    /** Connection string for redis containing url, credentials and port. */
    redisUri: string;
    /** Config for multitenancy. */
    multitenancyConfig?: {
        /** If set, then cache will working for multitenancy. It has to be multitenancy field indicator, that is set in the root of every mongodb record. */
        multitenantKey: string;
    },
    /** You can pass default ttl value for all operations, which will not have it passed as a parameter. By default is 60 seconds */
    defaultTtl?: number;
}

export type SpeedGooseCacheOperationParams = {
    /** It tells to speedgoose for how long given query should exists in cache. By default is 60 seconds. Set 0 to make it disable. */
    ttl?: number;
    /** Usefull only when using multitenancy. Could be set to distinguish cache keys between tenants.*/
    multitenantValue?: string;
    /** Your custom caching key.*/
    cacheKey?: string;
}

export type CacheClients = {
    resultsCache: Keyv<CachedResult>;
    recordsKeyCache: Keyv<string[]>;
    modelsKeyCache: Keyv<string[]>;
    singleRecordsCache: Keyv<Document>;
    singleRecordsKeyCache: Keyv<string[]>;
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
}

export enum CacheNamespaces {
    RESULTS_NAMESPACE = 'resultsNamespace',
    SINGLE_RECORDS_NAMESPACE = 'singleRecordsNamespace',
    KEY_RELATIONS_NAMESPACE = 'keyRelationsNamespace',
    MODELS_KEY_NAMESPACE = 'modelsKeyNamespace',
    SINGLE_RECORDS_KEY_NAMESPACE = 'singleRecordsKeyNamespace',
}

export enum GlobalDiContainerRegistryNames {
    CACHE_CLIENT_GLOBAL_ACCESS = 'globalCacheAccess',
    CONFIG_GLOBAL_ACCESS = 'speedGooseConfigAccess',
    MONGOOSE_GLOBAL_ACCESS = 'mongooseAccess',
    REDIS_GLOBAL_ACCESS = 'redisAccess'
}

export enum SpeedGooseRedisChannels {
    REMOVED_DOCUMENTS = 'speedgooseRemovedDocumentsChannel',
    SAVED_DOCUMENTS = 'speedgooseSavedDocumentsChannel',
}

export type MongooseDocumentEventCallback = (context: MongooseDocumentEventsContext, cacheClients: CacheClients) => void
