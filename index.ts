export { applySpeedGooseCacheLayer } from './src/wrapper';
export { SpeedGooseCacheAutoCleaner } from './src/plugin/SpeedGooseCacheAutoCleaner';
export { clearCacheForKey, clearCachedResultsForModel, clearCacheForRecordId, isCached } from './src/utils/cacheClientUtils';
export type { SpeedGooseConfig, SpeedGooseCacheOperationParams } from './src/types/types';
export { SpeedGooseDebuggerOperations, SharedCacheStrategies } from './src/types/types';
