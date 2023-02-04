import { Document, Query } from 'mongoose';
import { CachedDocument, DocumentWithIdAndTenantValue, SpeedGooseCacheAutoCleanerOptions } from '../types/types';
import { getConfig } from '../utils/commonUtils';

export const wasRecordDeleted = <T>(record: Document<T>, options: SpeedGooseCacheAutoCleanerOptions): boolean => {
    if (record && options?.wasRecordDeletedCallback) {
        return options.wasRecordDeletedCallback(record);
    }

    return false;
};

const getMultitenantKeyProjection = (): Record<string, number> => {
    const multitenantKey = getConfig().multitenancyConfig?.multitenantKey;

    return multitenantKey ? { [multitenantKey]: 1 } : {};
};

/* In case of 'many' actions - as they are query operation we have to predict affected ids by making same query to fetch them */
export const getRecordsAffectedByAction = async <T>(queryAction: Query<T, T>): Promise<DocumentWithIdAndTenantValue[]> => {
    const condition = queryAction.getFilter();
    const options = queryAction.getOptions();

    return queryAction.model.find<CachedDocument<T>>(condition, { _id: 1, ...getMultitenantKeyProjection() }, options).lean();
};

/* In case of 'many' actions - as they are query operation we have to predict affected ids by making same query to fetch them */
export const getRecordAffectedByAction = async <T>(queryAction: Query<T, T>): Promise<DocumentWithIdAndTenantValue> => {
    const condition = queryAction.getFilter();
    const options = queryAction.getOptions();

    return queryAction.model.findOne<CachedDocument<T>>(condition, { _id: 1, ...getMultitenantKeyProjection() }, options).lean();
};
