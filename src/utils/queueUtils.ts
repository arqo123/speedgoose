import * as Fastq from 'fastq';
import Container from 'typedi';
import { CacheSetQueuedTask, GlobalDiContainerRegistryNames, RefreshTtlQueuedTask } from '../types/types';

const setValueInCachedSet = async (task: CacheSetQueuedTask): Promise<void> => {
    const { value, client, namespace } = task;
    const cachedSet = (await client.get(namespace)) ?? new Set();

    cachedSet.add(value);
    await client.set(namespace, cachedSet);
};

const refreshTtlForCachedResult = async (task: RefreshTtlQueuedTask): Promise<void> => {
    const scheduledKeysSetForRefreshTtl: Set<string> = Container.get(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_SETS_QUEUE_ACCESS);
    const { refreshTtlFn, key } = task;
    await refreshTtlFn();
    
    if (scheduledKeysSetForRefreshTtl)
        scheduledKeysSetForRefreshTtl.delete(key);
};

export const isScheduledForRefreshTtl = (key: string): boolean => {
    const scheduledKeysSetForRefreshTtl: Set<string> = Container.get(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_SETS_QUEUE_ACCESS);
    if(scheduledKeysSetForRefreshTtl)
        return scheduledKeysSetForRefreshTtl.has(key);
    
    return false
  };


export const registerInternalQueueWorkers = (): void => {
    const internalCachedSetsQueue: Fastq.queueAsPromised<CacheSetQueuedTask> = Fastq.promise(setValueInCachedSet, 1);
    Container.set<Fastq.queueAsPromised<CacheSetQueuedTask>>(GlobalDiContainerRegistryNames.GLOBAL_CACHED_SETS_QUEUE_ACCESS, internalCachedSetsQueue);
    
    const scheduledKeysSetForRefreshTtl: Set<string> = new Set();
    Container.set<Set<string>>(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_SETS_QUEUE_ACCESS, scheduledKeysSetForRefreshTtl);

    const refreshTtlQueue: Fastq.queueAsPromised<RefreshTtlQueuedTask> = Fastq.promise(refreshTtlForCachedResult, 1);
    Container.set<Fastq.queueAsPromised<RefreshTtlQueuedTask>>(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_QUEUE_ACCESS, refreshTtlQueue);
};

export const getCachedSetsQueue = (): Fastq.queueAsPromised<CacheSetQueuedTask> => (Container.has(GlobalDiContainerRegistryNames.GLOBAL_CACHED_SETS_QUEUE_ACCESS) ? Container.get(GlobalDiContainerRegistryNames.GLOBAL_CACHED_SETS_QUEUE_ACCESS) : null);

export const getScheduledKeysSetForRefreshTtl = (): Set<string> => (
    Container.has(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_SETS_QUEUE_ACCESS) ? Container.get(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_SETS_QUEUE_ACCESS): null);

export const getRefreshTtlQueue = (): Fastq.queueAsPromised<RefreshTtlQueuedTask> =>
    Container.has(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_QUEUE_ACCESS) ? Container.get(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_QUEUE_ACCESS) : null;
