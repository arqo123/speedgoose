import {Container} from 'typedi'
import {Document, Mongoose} from "mongoose"
import Keyv from 'keyv';
import {CacheNamespaces, GlobalDiContainerRegistryNames, SpeedGooseConfig} from "./types/types"
import {addCachingToQuery} from "./extendQuery";
import {addCachingToAggregate} from "./extendAggregate";
import {registerRedisClient} from "./utils/redisUtils";
import {registerListenerForInternalEvents} from "./mongooseModelEvents";
import {objectDeserializer, objectSerializer} from './utils/commonUtils';

const registerGlobalConfigAccess = (config: SpeedGooseConfig): void => {
    Container.set<SpeedGooseConfig>(GlobalDiContainerRegistryNames.CONFIG_GLOBAL_ACCESS, {
        ...config,
        defaultTtl: config.defaultTtl ?? 60
    })
}

const createCacheWithNamespace = <T>(namespace) => new Keyv<T, any>((
    {
        namespace,
        serialize: objectSerializer,
        deserialize: objectDeserializer
    }))

const registerHydrationCaches = (): void => {
    Container.set<Keyv<Document, any>>(
        GlobalDiContainerRegistryNames.HYDRATED_DOCUMENTS_CACHE_ACCESS,
        createCacheWithNamespace(CacheNamespaces.HYDRATED_DOCUMENTS_NAMESPACE)
    )

    Container.set<Keyv<Set<string>>>(
        GlobalDiContainerRegistryNames.HYDRATED_DOCUMENTS_VARIATIONS_CACHE_ACCESS,
        createCacheWithNamespace(CacheNamespaces.HYDRATED_DOCUMENTS_VARIATIONS_KEY_NAMESPACE)
    )
}

const registerGlobalMongooseAccess = (mongoose: Mongoose): void => {
    Container.set<Mongoose>(GlobalDiContainerRegistryNames.MONGOOSE_GLOBAL_ACCESS, mongoose)
}

export const applySpeedGooseCacheLayer = async (mongoose: Mongoose, config: SpeedGooseConfig): Promise<void> => {
    await registerRedisClient(config.redisUri)
    registerGlobalConfigAccess(config)
    registerGlobalMongooseAccess(mongoose)
    registerHydrationCaches()
    registerListenerForInternalEvents(mongoose)
    addCachingToQuery(mongoose)
    addCachingToAggregate(mongoose)
}
