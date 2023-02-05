import { Query } from 'mongoose';
import { Model, SchemaType } from 'mongoose';
import { CachedDocument, SpeedGooseCacheOperationContext } from '../types/types';
import { setKeyInHydrationCaches } from './cacheClientUtils';
import { generateCacheKeyForSingleDocument } from './cacheKeyUtils';
import { getHydrationCache } from './commonUtils';
import { getValueFromDocument, isResultWithIds, getMongooseModelByName, setValueOnDocument, isMongooseUnpopulatedField } from './mongooseUtils';

type FieldWithReferenceModel = {
    path: string;
    referenceModelName: string;
};

const getReferenceModelNameFromSchema = (schema: SchemaType): string => {
    if (schema.options.ref) {
        return schema.options.ref as string;
    }
    if (Array.isArray(schema?.options?.type)) {
        return schema?.options?.type[0].ref;
    }
};

const getFieldsToHydrate = <T>(model: Model<T>): FieldWithReferenceModel[] =>
    Object.entries<SchemaType>({
        ...(model?.schema?.paths ?? {}),
        //@ts-expect-error singleNestedPaths might be not available in some of mongoose versions
        ...(model?.schema?.singleNestedPaths ?? {}),
    })
        .map(([path, schemaFieldType]) => ({ path, referenceModelName: getReferenceModelNameFromSchema(schemaFieldType) }))
        .filter(schemaPaths => schemaPaths.referenceModelName);

const getHydratedDocuments = <T>(query: Query<T, T>, context: SpeedGooseCacheOperationContext, results: CachedDocument<T>[]): Promise<CachedDocument<T>[]> => Promise.all(results.map(record => getHydratedDocument(query, context, record)));

const getHydratedDocument = async <T>(query: Query<T, T>, context: SpeedGooseCacheOperationContext, result: CachedDocument<T>): Promise<CachedDocument<T>> => {
    const cacheKey = generateCacheKeyForSingleDocument(query, result);
    const cachedValue = await getHydrationCache().get(cacheKey);

    if (cachedValue && cachedValue?._id) return cachedValue as CachedDocument<T>;

    const hydratedDocument = hydrateDocument(query, result);
    await setKeyInHydrationCaches(cacheKey, hydratedDocument, context);

    return hydratedDocument;
};

const hydrateDocument = <T>(query: Query<T, T>, record: CachedDocument<T>): CachedDocument<T> => deepHydrate(query.model, record);

const deepHydrate = <T>(model: Model<T>, record: CachedDocument<T>): CachedDocument<T> => {
    const hydratedRootDocument = model.hydrate(record) as CachedDocument<T>;

    for (const field of getFieldsToHydrate(model)) {
        if (field.referenceModelName && !isMongooseUnpopulatedField(record, field.path)) {
            const value = getValueFromDocument(field.path, record);

            if (!isResultWithIds(value)) continue;

            if (!Array.isArray(value)) {
                const hydratedValue = deepHydrate(getMongooseModelByName(field.referenceModelName), value as CachedDocument<T>);
                setValueOnDocument(field.path, hydratedValue, hydratedRootDocument);
            } else {
                const hydratedValue = value.map(valueToHydrate => deepHydrate(getMongooseModelByName(field.referenceModelName), valueToHydrate), hydratedRootDocument);
                setValueOnDocument(field.path, hydratedValue, hydratedRootDocument);
            }
        }
    }

    return hydratedRootDocument;
};

export const hydrateResults = <T>(query: Query<T, T>, context: SpeedGooseCacheOperationContext, result: CachedDocument<T> | CachedDocument<T>[]): Promise<CachedDocument<T> | CachedDocument<T>[]> =>
    Array.isArray(result) ? getHydratedDocuments(query, context, result) : getHydratedDocument(query, context, result);
