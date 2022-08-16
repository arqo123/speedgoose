import Container from "typedi"
import {SpeedGooseConfig,GlobalDiContainerRegistryNames} from "../types/types"

export const getConfig = (): SpeedGooseConfig =>
    Container.get<SpeedGooseConfig>(GlobalDiContainerRegistryNames.CONFIG_GLOBAL_ACCESS)

export const makeArrayUnique = <T>(array: T[]) => [...new Set(array)]

export const objectSerializer = <T>(record: T): T => record
export const objectDeserializer = <T>(record: T): T => record
