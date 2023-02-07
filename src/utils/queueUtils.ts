import * as Fastq from 'fastq';
import Container from 'typedi';
import { CacheSetQueuedTask, GlobalDiContainerRegistryNames, RefreshTtlQueuedTask } from '../types/types';

const setValueInCachedSet = async (task: CacheSetQueuedTask): Promise<void> => {
    const { value, client, namespace } = task;
    const cachedSet = (await client.get(namespace)) ?? new Set();

    cachedSet.add(value);
    await client.set(namespace, cachedSet);
};

const refreshTttForCachedResult = async (task: RefreshTtlQueuedTask): Promise<void> => {
    const { refreshTtlFn } = task;
    await refreshTtlFn();
};

export const registerInternalQueueWorkers = (): void => {
    const internalCachedSetsQueue: Fastq.queueAsPromised<CacheSetQueuedTask> = Fastq.promise(setValueInCachedSet, 1);
    Container.set<Fastq.queueAsPromised<CacheSetQueuedTask>>(GlobalDiContainerRegistryNames.GLOBAL_CACHED_SETS_QUEUE_ACCESS, internalCachedSetsQueue);
    
    const refreshTtlQueue: Fastq.queueAsPromised<RefreshTtlQueuedTask> = Fastq.promise(refreshTttForCachedResult, 1);
    Container.set<Fastq.queueAsPromised<RefreshTtlQueuedTask>>(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_QUEUE_ACCESS, refreshTtlQueue);
};

export const getCachedSetsQueue = (): Fastq.queueAsPromised<CacheSetQueuedTask> => (Container.has(GlobalDiContainerRegistryNames.GLOBAL_CACHED_SETS_QUEUE_ACCESS) ? Container.get(GlobalDiContainerRegistryNames.GLOBAL_CACHED_SETS_QUEUE_ACCESS) : null);

export const getRefreshTtlQueue = (): Fastq.queueAsPromised<RefreshTtlQueuedTask> =>
    Container.has(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_QUEUE_ACCESS) ? Container.get(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_QUEUE_ACCESS) : null;
