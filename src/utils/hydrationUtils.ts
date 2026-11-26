import mpath from 'mpath';
import { Model, Query, Schema, SchemaType } from 'mongoose';
import { CachedDocument, SpeedGooseCacheOperationContext, SpeedGoosePopulateOptions } from '../types/types';
import { getMongooseModelByName, isMongooseDocument, markPathPopulated } from './mongooseUtils';
import { ensurePopulatePathsInProjection } from './queryUtils';

type Projection = Record<string, unknown>;
type ProjectionFor = (model: Model<unknown>) => Projection | undefined;
type ChildProjectionFor = (path: string, model: Model<unknown>) => Projection | undefined;
type RefOptions = { ref?: unknown; refPath?: string };
type PlainRecord = Record<string, unknown>;
type RefPath = { path: string; schemaType: SchemaType };
type DocumentConstructor = new (obj: undefined, fields: Projection | undefined, options: Record<string, unknown>) => CachedDocument<unknown>;
type QueryInternals = Query<unknown, unknown> & {
    model: Model<unknown>;
    _applyPaths?: () => void;
    _mongooseOptions: { speedGoosePopulate?: SpeedGoosePopulateOptions[]; populate?: Record<string, { select?: unknown }> };
};

export const getReferenceModelNameFromSchema = (schema: SchemaType): string => {
    if (schema?.options?.ref) {
        return schema.options.ref as string;
    }
    if (Array.isArray(schema?.options?.type) && schema.options.type.length) {
        return schema?.options?.type[0].ref;
    }
    return (schema as { embeddedSchemaType?: SchemaType })?.embeddedSchemaType?.options?.ref as string;
};

// The `ref` / `refPath` options of a path, for single refs and for arrays of refs.
const getRefOptions = (schemaType: SchemaType): RefOptions => {
    const candidates = [schemaType?.options, Array.isArray(schemaType?.options?.type) ? schemaType.options.type[0] : undefined, (schemaType as { embeddedSchemaType?: SchemaType })?.embeddedSchemaType?.options];
    const options = candidates.find(candidate => candidate?.ref || candidate?.refPath);
    return { ref: options?.ref, refPath: options?.refPath };
};

const refPathsBySchema = new WeakMap<Schema, RefPath[]>();

/** All paths in a schema that hold refs, including paths inside subdocuments (like `members.user`). */
const getRefPaths = (schema: Schema, ancestors = new Set<Schema>()): RefPath[] => {
    const known = refPathsBySchema.get(schema);
    if (known) return known;

    const refPaths: RefPath[] = [];
    ancestors.add(schema);
    schema.eachPath((path, schemaType) => {
        const { ref, refPath } = getRefOptions(schemaType);
        if (ref || refPath) {
            refPaths.push({ path, schemaType });
            return;
        }
        const subdocumentSchema = (schemaType as { schema?: Schema }).schema;
        // Stop if a schema contains itself, to avoid an endless loop.
        if (subdocumentSchema && !ancestors.has(subdocumentSchema)) {
            for (const nested of getRefPaths(subdocumentSchema, ancestors)) refPaths.push({ path: `${path}.${nested.path}`, schemaType: nested.schemaType });
        }
    });
    ancestors.delete(schema);
    refPathsBySchema.set(schema, refPaths);

    return refPaths;
};

const isModel = (value: unknown): value is Model<unknown> => typeof value === 'function' && typeof (value as Model<unknown>).hydrate === 'function';

// Finds a model by name, on the owner's connection first.
const getModel = (nameOrModel: unknown, ownerModel: Model<unknown>): Model<unknown> | undefined => {
    if (isModel(nameOrModel)) return nameOrModel;
    if (typeof nameOrModel !== 'string') return undefined;
    return (ownerModel.db?.models?.[nameOrModel] as Model<unknown>) ?? getMongooseModelByName(nameOrModel);
};

/**
 * The model of a populated path. `ref` can be a name, a model or a function that returns one of those. With
 * `refPath`, each document stores the model name in another field, so the result is that field's value(s),
 * in the same shape as the populated value (one name, or an array of names).
 */
const getRefModelNames = (schemaType: SchemaType, ownerModel: Model<unknown>, record: PlainRecord): unknown => {
    const { ref, refPath } = getRefOptions(schemaType);
    if (refPath) return mpath.get(refPath, record);
    if (typeof ref === 'function' && !isModel(ref)) {
        try {
            return (ref as (doc: unknown) => unknown).call(record, record);
        } catch {
            return undefined;
        }
    }
    return ref;
};

/** The model mongoose would use for `record`: the discriminator named in its discriminator key, or the model itself. */
const resolveDiscriminatorModel = (model: Model<unknown>, record: PlainRecord): Model<unknown> => {
    const mapping = (model.schema as { discriminatorMapping?: { key?: string; isRoot?: boolean } }).discriminatorMapping;
    const value = mapping?.isRoot && mapping.key ? record[mapping.key] : undefined;
    if (value == null || !model.discriminators) return model;

    const discriminators = model.discriminators as Record<string, Model<unknown>>;
    return discriminators[String(value)] ?? Object.values(discriminators).find(discriminator => (discriminator.schema as { discriminatorMapping?: { value?: unknown } }).discriminatorMapping?.value === value) ?? model;
};

// In cached JSON, a populated value is an object with an _id. A ref that wasn't populated is just the id.
const isPopulatedRecord = (value: unknown): value is PlainRecord =>
    value !== null && typeof value === 'object' && !Array.isArray(value) && !isMongooseDocument(value) && (value as PlainRecord)._id != null && Object.getPrototypeOf(value) === Object.prototype;

const containsPopulatedRecord = (value: unknown): boolean => (Array.isArray(value) ? value.some(containsPopulatedRecord) : isPopulatedRecord(value));

// Takes the ids from the built documents, so they are ObjectIds rather than JSON strings. depopulate() puts these exact values back.
const getPopulatedIds = (value: unknown): unknown => (Array.isArray(value) ? value.map(getPopulatedIds) : isMongooseDocument(value) ? value._id : value);

const withoutProjection: ChildProjectionFor = () => undefined;

/**
 * Builds a document from a cached plain record the way mongoose builds one from a query result: the right
 * (discriminator) class, init instead of set, and the projection of the query, so unselected paths get no
 * defaults and a later save() writes only real changes. Populated children, at any depth, are built first and
 * registered as populated. Note: it changes `record` in place, which is fine because the record was just read from the cache.
 */
const buildDocument = (model: Model<unknown>, record: PlainRecord, projection: Projection | undefined, childProjectionFor: ChildProjectionFor = withoutProjection): CachedDocument<unknown> => {
    const DocumentModel = resolveDiscriminatorModel(model, record);
    const populatedPaths: { path: string; ids: unknown }[] = [];

    for (const { path, schemaType } of getRefPaths(DocumentModel.schema)) {
        const value = mpath.get(path, record);
        if (!containsPopulatedRecord(value)) continue;

        let allResolved = true;
        // Walks the populated value and its model name(s) side by side, as both can be nested arrays.
        const buildChildren = (item: unknown, modelName: unknown): unknown => {
            if (Array.isArray(item)) return item.map((child, index) => buildChildren(child, Array.isArray(modelName) ? modelName[index] : modelName));
            if (!isPopulatedRecord(item)) return item;

            const refModel = getModel(modelName, DocumentModel);
            if (!refModel) {
                // Unknown model: keep the reference itself rather than an object mongoose can't cast.
                allResolved = false;
                return item._id;
            }
            return buildDocument(refModel, item, childProjectionFor(path, refModel));
        };
        const children = buildChildren(value, getRefModelNames(schemaType, DocumentModel, record));
        mpath.set(path, children, record);
        if (allResolved) populatedPaths.push({ path, ids: getPopulatedIds(children) });
    }

    const document = new (DocumentModel as unknown as DocumentConstructor)(undefined, projection, { skipId: true, isNew: false, willInit: true });
    document.init(record);
    for (const { path, ids } of populatedPaths) markPathPopulated(document, path, ids);

    return document;
};

/**
 * The projection mongoose applies when it runs `query` for `model`, schema-level `select: false` paths and
 * cachePopulate paths included. On a cache hit the query never ran, so this is computed on a copy of it.
 */
const getEffectiveProjection = (query: Query<unknown, unknown>, model: Model<unknown>): Projection | undefined => {
    let projection: Projection | undefined;
    try {
        const effectiveQuery = query.clone() as QueryInternals;
        // A discriminator can have its own select: false fields, so use its schema (mongoose's createModel does the same).
        effectiveQuery.model = model;
        ensurePopulatePathsInProjection(effectiveQuery, effectiveQuery._mongooseOptions?.speedGoosePopulate ?? []);
        effectiveQuery._applyPaths?.();
        projection = effectiveQuery.projection() as Projection | undefined;
    } catch {
        projection = query.projection() as Projection | undefined;
    }

    return projection && Object.keys(projection).length > 0 ? projection : undefined;
};

const createProjectionResolver = (query: Query<unknown, unknown>): ProjectionFor => {
    const projections = new Map<Model<unknown>, Projection | undefined>();

    return model => {
        if (!projections.has(model)) projections.set(model, getEffectiveProjection(query, model));
        return projections.get(model);
    };
};

// The `select` given to populate() or cachePopulate() for each path of the query.
const getPopulateSelects = (query: Query<unknown, unknown>): Map<string, unknown> => {
    const options = (query as QueryInternals)._mongooseOptions ?? {};
    const selects = new Map<string, unknown>();
    for (const [path, populate] of Object.entries(options.populate ?? {})) {
        if (populate?.select) selects.set(path, populate.select);
    }
    for (const populate of options.speedGoosePopulate ?? []) {
        if (populate?.select) selects.set(populate.path, populate.select);
    }
    return selects;
};

/**
 * Projections for populated documents, taken from the `select` of their populate call, so a populated document
 * rebuilt from the cache doesn't get default values for fields that weren't selected.
 */
const createChildProjectionResolver = (query: Query<unknown, unknown>): ChildProjectionFor => {
    const selects = getPopulateSelects(query);
    const projections = new Map<string, Projection | undefined>();

    return (path, model) => {
        const select = selects.get(path);
        if (select == null) return undefined;

        const key = `${path}|${model.modelName}`;
        if (!projections.has(key)) {
            let projection: Projection | undefined;
            try {
                const childQuery = model.find().select(select as string) as QueryInternals;
                childQuery._applyPaths?.();
                projection = childQuery.projection() as Projection | undefined;
            } catch {
                projection = undefined;
            }
            projections.set(key, projection && Object.keys(projection).length > 0 ? projection : undefined);
        }
        return projections.get(key);
    };
};

/**
 * Turns cached plain records into documents. Records that already are documents (copies handed to concurrent
 * callers of a cache miss) are returned as they are.
 */
export const hydrateResults = async <T>(query: Query<T, T>, _context: SpeedGooseCacheOperationContext, result: CachedDocument<T> | CachedDocument<T>[]): Promise<CachedDocument<T> | CachedDocument<T>[]> => {
    const projectionFor = createProjectionResolver(query as Query<unknown, unknown>);
    const childProjectionFor = createChildProjectionResolver(query as Query<unknown, unknown>);
    const hydrate = (record: CachedDocument<T>): CachedDocument<T> => {
        if (!record || isMongooseDocument(record)) return record;
        const plainRecord = record as unknown as PlainRecord;
        const model = resolveDiscriminatorModel(query.model as Model<unknown>, plainRecord);
        return buildDocument(model, plainRecord, projectionFor(model), childProjectionFor) as CachedDocument<T>;
    };

    return Array.isArray(result) ? result.map(hydrate) : hydrate(result);
};
