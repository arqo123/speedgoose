import * as Fastq from 'fastq';
import Container from 'typedi';
import { GlobalDiContainerRegistryNames, RefreshTtlQueuedTask, SpeedGooseCacheOperationContext } from '../types/types';
import { getCacheStrategyInstance } from './commonUtils';

export const registerInternalQueueWorkers = (): void => {
    const refreshTTLQueue = Fastq.promise(refreshTTLForCachedResult, 1);
    Container.set<Set<string>>(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_SETS_QUEUE_ACCESS, new Set());
    Container.set<Fastq.queueAsPromised<RefreshTtlQueuedTask>>(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_QUEUE_ACCESS, refreshTTLQueue);
};

const refreshTTLForCachedResult = async (task: RefreshTtlQueuedTask): Promise<void> => {
    try {
        await getCacheStrategyInstance()?.refreshTTLForCachedResult(task.key, task.ttl);
    } finally {
        getScheduledKeysSetForRefreshTtl()?.delete(task.key);
    }
};

const getScheduledKeysSetForRefreshTtl = (): Set<string> => (Container.has(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_SETS_QUEUE_ACCESS) ? Container.get(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_SETS_QUEUE_ACCESS) : null);

const getRefreshTtlQueue = (): Fastq.queueAsPromised<RefreshTtlQueuedTask> => (Container.has(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_QUEUE_ACCESS) ? Container.get(GlobalDiContainerRegistryNames.GLOBAL_REFRESH_TTL_QUEUE_ACCESS) : null);

/** Queues a TTL refresh for the key unless one is already pending. Resolves to whether it was queued. */
export const scheduleTTlRefreshing = async (context: SpeedGooseCacheOperationContext): Promise<boolean> => {
    const scheduledKeys = getScheduledKeysSetForRefreshTtl();
    if (scheduledKeys.has(context.cacheKey)) return false;

    scheduledKeys.add(context.cacheKey);
    context.debug(`Refreshing TTL time for key ${context.cacheKey}`);
    await getRefreshTtlQueue().push({ key: context.cacheKey, ttl: context.ttl });
    return true;
};
