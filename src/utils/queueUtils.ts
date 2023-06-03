import * as Fastq from 'fastq';
import Container from 'typedi';
import { CacheSetQueuedTask, CachedResult, GlobalDiContainerRegistryNames, RefreshTtlQueuedTask, SpeedGooseCacheOperationContext } from '../types/types';
import { getCacheStrategyInstance } from './commonUtils';

const setValueInCachedSet = async (task: CacheSetQueuedTask): Promise<void> => {
    const { value, client, namespace } = task;
    const cachedSet = (await client.get(namespace)) ?? new Set();

    cachedSet.add(value);
    await client.set(namespace, cachedSet);
};

export const registerInternalQueueWorkers = (): void => {
    const internalCachedSetsQueue: Fastq.queueAsPromised<CacheSetQueuedTask> = Fastq.promise(setValueInCachedSet, 1);
    Container.set<Fastq.queueAsPromised<CacheSetQueuedTask>>(GlobalDiContainerRegistryNames.GLOBAL_CACHED_SETS_QUEUE_ACCESS, internalCachedSetsQueue);

    const refreshTTLQueue = Fastq.promise(refreshTTLForCachedResult, 1);
    Container.set<Set<string>>(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_SETS_QUEUE_ACCESS, new Set());
    Container.set<Fastq.queueAsPromised<RefreshTtlQueuedTask>>(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_QUEUE_ACCESS, refreshTTLQueue);
};

export const getCachedSetsQueue = (): Fastq.queueAsPromised<CacheSetQueuedTask> => (Container.has(GlobalDiContainerRegistryNames.GLOBAL_CACHED_SETS_QUEUE_ACCESS) ? Container.get(GlobalDiContainerRegistryNames.GLOBAL_CACHED_SETS_QUEUE_ACCESS) : null);

const refreshTTLForCachedResult = async (task: RefreshTtlQueuedTask): Promise<void> => {
    await getCacheStrategyInstance().refreshTTLForCachedResult(task.key, task.ttl, task.value);
    const scheduledKeysSetForRefreshTtl: Set<string> = Container.get(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_SETS_QUEUE_ACCESS);

    if (scheduledKeysSetForRefreshTtl) scheduledKeysSetForRefreshTtl.delete(task.key);
};

const getScheduledKeysSetForRefreshTtl = (): Set<string> => (Container.has(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_SETS_QUEUE_ACCESS) ? Container.get(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_SETS_QUEUE_ACCESS) : null);

const getRefreshTtlQueue = (): Fastq.queueAsPromised<RefreshTtlQueuedTask> => (Container.has(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_QUEUE_ACCESS) ? Container.get(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_QUEUE_ACCESS) : null);

export const scheduleTTlRefreshing = async <T>(context: SpeedGooseCacheOperationContext, value: CachedResult<T>): Promise<void> => {
    const isAlreadyScheduled = getScheduledKeysSetForRefreshTtl().has(context.cacheKey);
    if (!isAlreadyScheduled) {
        context.debug(`Refreshing TTL time for key ${context.cacheKey}`);
        await getRefreshTtlQueue().push({ key: context.cacheKey, ttl: context.ttl, value });
    }
};