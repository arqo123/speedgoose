import Container from 'typedi';
import { SpeedGooseConfig, GlobalDiContainerRegistryNames, CacheStrategiesTypes } from '../types/types';

export const getConfig = (): SpeedGooseConfig | null => {
    try {
        return Container.get<SpeedGooseConfig>(GlobalDiContainerRegistryNames.CONFIG_GLOBAL_ACCESS);
    } catch {
        return null;
    }
};

export const objectSerializer = <T>(record: T): T => record;
export const objectDeserializer = <T>(record: T): T => record;

export const getCacheStrategyInstance = (): CacheStrategiesTypes => Container.get<CacheStrategiesTypes>(GlobalDiContainerRegistryNames.CACHE_CLIENT_GLOBAL_ACCESS);

export const isCachingEnabled = (): boolean => getConfig()?.enabled ?? false;

export const customStringifyReplacer = (key: string, value: unknown): unknown => {
    if (value instanceof RegExp) {
        return `regex:${value.toString()}`;
    }

    return value;
};