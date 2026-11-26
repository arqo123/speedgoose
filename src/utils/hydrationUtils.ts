import mpath from 'mpath';
import { Model, Query, Schema, SchemaType } from 'mongoose';
import { CachedDocument, SpeedGooseCacheOperationContext, SpeedGoosePopulateOptions } from '../types/types';
import { getMongooseModelByName, isMongooseDocument, markPathPopulated } from './mongooseUtils';
import { ensurePopulatePathsInProjection } from './queryUtils';

type Projection = Record<string, unknown>;
type ProjectionFor = (model: Model<unknown>) => Projection | undefined;
// For a populated path: the projection to build its documents with, and the same lookup for the paths inside them.
type ChildProjectionFor = (path: string, model: Model<unknown>) => { projection: Projection | undefined; nested: ChildProjectionFor };
type RefOptions = { ref?: unknown; refPath?: unknown };
type PopulateOption = { path?: string; select?: unknown; populate?: unknown };
// Populate options by path, with the options of nested populates under each path.
type PopulateTree = Map<string, { select?: unknown; children: PopulateTree }>;
type PlainRecord = Record<string, unknown>;
type RefPath = { path: string; schemaType: SchemaType };
type DocumentConstructor = new (obj: undefined, fields: Projection | undefined, options: Record<string, unknown>) => CachedDocument<unknown>;
type QueryInternals = Query<unknown, unknown> & {
    model: Model<unknown>;
    _applyPaths?: () => void;
    _mongooseOptions: { speedGoosePopulate?: SpeedGoosePopulateOptions[]; populate?: Record<string, PopulateOption> };
};

const { isArray } = Array;

// User functions (ref, refPath) may throw on a plain cached record; treat that as "model unknown".
const callSafely = (fn: () => unknown): unknown => {
    try {
        return fn();
    } catch {
        return undefined;
    }
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
const getRefModelNames = (schemaType: SchemaType, path: string, record: PlainRecord): unknown => {
    const { ref, refPath } = getRefOptions(schemaType);
    if (typeof refPath === 'function') {
        const resolvedPath = callSafely(() => (refPath as (doc: unknown, path: string) => unknown).call(record, record, path));
        return typeof resolvedPath === 'string' ? mpath.get(resolvedPath, record) : undefined;
    }
    if (typeof refPath === 'string') return mpath.get(refPath, record);
    if (typeof ref !== 'function' || isModel(ref)) return ref;

    // Like mongoose, call the function with the subdocument that holds the ref (the record itself for a top-level path).
    const ownerPath = path.slice(0, Math.max(0, path.length - (schemaType as { path: string }).path.length - 1));
    const callRef = (owner: unknown): unknown => (isArray(owner) ? owner.map(callRef) : owner == null ? undefined : callSafely(() => (ref as (doc: unknown) => unknown).call(owner, owner)));
    return callRef(ownerPath ? mpath.get(ownerPath, record) : record);
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

/**
 * Builds a document from a cached plain record the way mongoose builds one from a query result: the right
 * (discriminator) class, init instead of set, and the projection of the query, so unselected paths get no
 * defaults and a later save() writes only real changes. Populated children, at any depth, are built first and
 * registered as populated. Note: it changes `record` in place, which is fine because the record was just read from the cache.
 */
const buildDocument = (model: Model<unknown>, record: PlainRecord, projection: Projection | undefined, childProjectionFor: ChildProjectionFor): CachedDocument<unknown> => {
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
            const { projection: childProjection, nested } = childProjectionFor(path, refModel);
            return buildDocument(refModel, item, childProjection, nested);
        };
        const children = buildChildren(value, getRefModelNames(schemaType, path, record));
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

// Populate options can be a path string ('a b'), an options object, or an array of either.
const toPopulateOptions = (populate: unknown): PopulateOption[] => {
    if (typeof populate === 'string')
        return populate
            .split(/\s+/)
            .filter(Boolean)
            .map(path => ({ path }));
    if (isArray(populate)) return populate.flatMap(toPopulateOptions);
    return populate && typeof populate === 'object' ? [populate as PopulateOption] : [];
};

const buildPopulateTree = (options: PopulateOption[]): PopulateTree => {
    const tree: PopulateTree = new Map();
    for (const option of options) {
        if (!option?.path) continue;
        for (const path of option.path.split(/\s+/).filter(Boolean)) tree.set(path, { select: option.select, children: buildPopulateTree(toPopulateOptions(option.populate)) });
    }
    return tree;
};

// The populate options of a query: populate() and cachePopulate(), with their nested populates.
const getPopulateTree = (query: Query<unknown, unknown>): PopulateTree => {
    const options = (query as QueryInternals)._mongooseOptions ?? {};
    return buildPopulateTree([...Object.values(options.populate ?? {}), ...(options.speedGoosePopulate ?? [])]);
};

// The projection mongoose uses when it loads populated documents: the populate `select` plus the schema's `select: false` fields.
const getPopulatedProjection = (model: Model<unknown>, select: unknown): Projection | undefined => {
    try {
        const query = model.find() as QueryInternals;
        if (select != null) query.select(select as string);
        query._applyPaths?.();
        const projection = query.projection() as Projection | undefined;
        return projection && Object.keys(projection).length > 0 ? projection : undefined;
    } catch {
        return undefined;
    }
};

/**
 * Projections for populated documents, so a populated document rebuilt from the cache doesn't get default values
 * for fields its populate didn't load. Works at every depth of nested populates.
 */
const createChildProjectionResolver = (tree: PopulateTree): ChildProjectionFor => {
    const resolved = new Map<string, ReturnType<ChildProjectionFor>>();

    return (path, model) => {
        const key = `${path}|${model.modelName}`;
        if (!resolved.has(key)) {
            const options = tree.get(path);
            resolved.set(key, { projection: getPopulatedProjection(model, options?.select), nested: createChildProjectionResolver(options?.children ?? new Map()) });
        }
        return resolved.get(key);
    };
};

/**
 * Turns cached plain records into documents. Records that already are documents (copies handed to concurrent
 * callers of a cache miss) are returned as they are.
 */
export const hydrateResults = async <T>(query: Query<T, T>, _context: SpeedGooseCacheOperationContext, result: CachedDocument<T> | CachedDocument<T>[]): Promise<CachedDocument<T> | CachedDocument<T>[]> => {
    const projectionFor = createProjectionResolver(query as Query<unknown, unknown>);
    const childProjectionFor = createChildProjectionResolver(getPopulateTree(query as Query<unknown, unknown>));
    const hydrate = (record: CachedDocument<T>): CachedDocument<T> => {
        if (!record || isMongooseDocument(record)) return record;
        const plainRecord = record as unknown as PlainRecord;
        const model = resolveDiscriminatorModel(query.model as Model<unknown>, plainRecord);
        return buildDocument(model, plainRecord, projectionFor(model), childProjectionFor) as CachedDocument<T>;
    };

    return Array.isArray(result) ? result.map(hydrate) : hydrate(result);
};
