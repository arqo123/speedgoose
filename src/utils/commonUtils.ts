import Keyv from "keyv"
import {Document} from "mongoose"
import Container from "typedi"
import {SpeedGooseConfig, GlobalDiContainerRegistryNames} from "../types/types"

export const getConfig = (): SpeedGooseConfig =>
    Container.get<SpeedGooseConfig>(GlobalDiContainerRegistryNames.CONFIG_GLOBAL_ACCESS)

export const objectSerializer = <T>(record: T): T => record
export const objectDeserializer = <T>(record: T): T => record

export const getHydrationCache = (): Keyv<Document> =>
    Container.get<Keyv<Document>>(GlobalDiContainerRegistryNames.HYDRATED_DOCUMENTS_CACHE_ACCESS)

export const getHydrationVariationsCache = (): Keyv<Set<string>> =>
    Container.get<Keyv<Set<string>>>(GlobalDiContainerRegistryNames.HYDRATED_DOCUMENTS_VARIATIONS_CACHE_ACCESS)
