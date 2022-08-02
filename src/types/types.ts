import './mongoose'
import {Document} from "mongoose";
import Keyv from "keyv";

export type AggregationResult = unknown

export type CachedDocument = Document | Document[]

export type CachedResult = CachedDocument | AggregationResult | number

export type CacheOptions = {namespace: string, store: any}

export type SpeedGooseCacheAutoCleanerOptions = {
    wasRecordDeletedCallback: <T>(record: Document<T>) => boolean
}

export type SpeedGooseCacheLayerConfig = {
    redisUri: string;
    redisIndex?: string;
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
    AFTER_SAVE = 'afterSave'
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