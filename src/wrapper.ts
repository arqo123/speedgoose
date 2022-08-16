import Keyv from "keyv";
import {Container} from 'typedi'
import KeyvRedis from "@keyv/redis"
import {Mongoose, Document} from "mongoose"
import {CacheClients, CachedResult, CacheNamespaces, GlobalDiContainerRegistryNames, SpeedGooseConfig} from "./types/types"
import {addCachingToQuery} from "./extendQuery";
import {addCachingToAggregate} from "./extendAggregate";
import {objectDeserializer, objectSerializer} from "./utils/commonUtils";
import {getRedisInstance, registerRedisClient} from "./utils/redisUtils";
import {registerListenerForInternalEvents} from "./mongooseModelEvents";

const registerGlobalCacheAccess = (cacheClients: CacheClients): void => {
    Container.set<CacheClients>(GlobalDiContainerRegistryNames.CACHE_CLIENT_GLOBAL_ACCESS, cacheClients)
}

const registerGlobalConfigAccess = (config: SpeedGooseConfig): void => {
    Container.set<SpeedGooseConfig>(GlobalDiContainerRegistryNames.CONFIG_GLOBAL_ACCESS, {
        ...config,
        defaultTtl: config.defaultTtl ?? 60
    })
}

const registerGlobalMongooseAccess = (mongoose: Mongoose): void => {
    Container.set<Mongoose>(GlobalDiContainerRegistryNames.MONGOOSE_GLOBAL_ACCESS, mongoose)
}

const clearCacheOnClients = (cacheClients: CacheClients): Promise<void[]> =>
    Promise.all(Object.values(cacheClients).map(client => client.clear()))

const prepareCacheClients = async (): Promise<CacheClients> => {
    const keyvRedis = new KeyvRedis(getRedisInstance());

    const clients: CacheClients = {
        resultsCache: new Keyv<CachedResult, any>({namespace: CacheNamespaces.RESULTS_NAMESPACE, store: keyvRedis}),
        recordsKeyCache: new Keyv<string[], any>({namespace: CacheNamespaces.KEY_RELATIONS_NAMESPACE, store: keyvRedis}),
        modelsKeyCache: new Keyv<string[], any>({namespace: CacheNamespaces.MODELS_KEY_NAMESPACE, store: keyvRedis}),
        singleRecordsCache: new Keyv<Document, any>({namespace: CacheNamespaces.SINGLE_RECORDS_NAMESPACE, serialize: objectSerializer, deserialize: objectDeserializer}),
        singleRecordsKeyCache: new Keyv<string[], any>({namespace: CacheNamespaces.SINGLE_RECORDS_KEY_NAMESPACE})
    }
 
    await clearCacheOnClients(clients)
    
    return clients
}

export const applySpeedGooseCacheLayer = async (mongoose: Mongoose, config: SpeedGooseConfig): Promise<void> => {
    await registerRedisClient(config.redisUri)
    const cacheClients = await prepareCacheClients()
    registerGlobalCacheAccess(cacheClients)
    registerGlobalConfigAccess(config)
    registerGlobalMongooseAccess(mongoose)
    registerListenerForInternalEvents(mongoose, cacheClients)
    addCachingToQuery(mongoose, cacheClients)
    addCachingToAggregate(mongoose, cacheClients)
}
