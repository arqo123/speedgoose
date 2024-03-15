import { Document, Aggregate, Query } from 'mongoose';
import { CachedDocument, DocumentWithIdAndTenantValue } from '../types/types';
import { customStringifyReplacer, getConfig } from './commonUtils';
import { stringifyPopulatedPaths, stringifyQueryParam } from './queryUtils';

export const generateCacheKeyFromQuery = <T>(query: Query<T, T>): string =>
    JSON.stringify(
        {
            query: query.getQuery(),
            collection: query.mongooseCollection.name,
            op: query.op,
            projection: { ...query.projection(), ...(query.getOptions().projection as Record<string, number>) },
            options: { ...query.getOptions(), projection: undefined },
        },
        customStringifyReplacer,
    );

export const generateCacheKeyFromPipeline = <R>(aggregation: Aggregate<R[], R>): string =>
    JSON.stringify(
        {
            pipeline: aggregation.pipeline(),
            collection: aggregation._model.collection.name,
        },
        customStringifyReplacer,
    );

export const generateCacheKeyForSingleDocument = <T>(query: Query<T, T>, record: CachedDocument<T>): string => {
    if (!record) return '';
    
    if (!query.selected() && query.getPopulatedPaths().length === 0) {
        return String(record._id);
    }

    const projectionFields = stringifyQueryParam((query?.projection() as Record<string, number>) ?? {});
    const populationFields = stringifyPopulatedPaths(query?.getPopulatedPaths() ?? []);

    return `${record?._id}_${projectionFields}_${populationFields}`;
};

export const generateCacheKeyForModelName = (modelName: string, multitenantValue = ''): string => `${modelName}_${String(multitenantValue)}`;

export const generateCacheKeyForRecordAndModelName = <T>(record: Document<T> | DocumentWithIdAndTenantValue, modelName: string): string => {
    const config = getConfig();
    const multitenantKey = config?.multitenancyConfig?.multitenantKey;

    return multitenantKey ? `${modelName}_${String(record[multitenantKey])}` : modelName;
};
