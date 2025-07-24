import { Container } from 'typedi';
import { GlobalDiContainerRegistryNames } from '../types/types';
import Keyv from 'keyv';

export const clearAllCaches = async (): Promise<void> => {
    const hydrationCache = Container.get<Keyv>(GlobalDiContainerRegistryNames.HYDRATED_DOCUMENTS_CACHE_ACCESS);
    const variationsCache = Container.get<Keyv>(GlobalDiContainerRegistryNames.HYDRATED_DOCUMENTS_VARIATIONS_CACHE_ACCESS);
    
    await hydrationCache.clear();
    await variationsCache.clear();
};