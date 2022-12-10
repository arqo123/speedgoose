import Keyv from "keyv"
import Container from "typedi"
import {SpeedGooseConfig, GlobalDiContainerRegistryNames, CacheStrategiesTypes, CachedDocument} from "../types/types"

export const getConfig = (): SpeedGooseConfig =>
    Container.get<SpeedGooseConfig>(GlobalDiContainerRegistryNames.CONFIG_GLOBAL_ACCESS)

export const objectSerializer = <T>(record: T): T => record
export const objectDeserializer = <T>(record: T): T => record

export const getHydrationCache = (): Keyv<CachedDocument<unknown>> =>
    Container.get<Keyv<CachedDocument<unknown>>>(GlobalDiContainerRegistryNames.HYDRATED_DOCUMENTS_CACHE_ACCESS)

export const getHydrationVariationsCache = (): Keyv<Set<string>> =>
    Container.get<Keyv<Set<string>>>(GlobalDiContainerRegistryNames.HYDRATED_DOCUMENTS_VARIATIONS_CACHE_ACCESS)

export const getCacheStrategyInstance = (): CacheStrategiesTypes =>
    Container.get<CacheStrategiesTypes>(GlobalDiContainerRegistryNames.CACHE_CLIENT_GLOBAL_ACCESS)

export const isCachingEnabled = (): boolean => getConfig()?.enabled