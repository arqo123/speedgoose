import { Document } from 'mongoose';
import { getConfig } from './commonUtils';
import { isMongooseDocument } from './mongooseUtils';

type PopulateOptions = Record<string | symbol, unknown>;
type PopulatedPath = { value: unknown; options?: PopulateOptions };

type DocumentInternals = Document & {
    $__: { selected?: Record<string, unknown>; populated?: Record<string, PopulatedPath>; strictMode?: unknown };
    $$populatedVirtuals?: Record<string, unknown>;
    $isSubdocument?: boolean;
    _doc: Record<string, unknown>;
    populated(path: string, value?: unknown, options?: PopulateOptions): unknown;
};

type DocumentConstructor = new (obj: undefined, fields: unknown, options: Record<string, unknown>) => DocumentInternals;
type BinaryLike = { _bsontype: 'Binary'; sub_type: number; value(): Uint8Array };
type CopiedObjects = WeakMap<object, unknown>;

/**
 * toObject() options that give the raw stored data: no user transforms, getters or virtuals, and populated documents
 * are kept. Maps are flattened because otherwise the Map would still point to the original values.
 */
export const RAW_SNAPSHOT_OPTIONS = {
    transform: false,
    virtuals: false,
    getters: false,
    depopulate: false,
    versionKey: true,
    minimize: false,
    flattenMaps: true,
    flattenObjectIds: false,
    flattenUUIDs: false,
    useProjection: false,
} as const;

// Populate options that hold the populated documents themselves. The copy must not keep a reference to them.
const POPULATED_DOCUMENT_REFERENCES = new Set(['_docs', '_childDocs']);

// Saved once at load time. This code runs for every object of every cached read, and inside a vm context (such as
// Jest) each lookup of a global like `Object` or `Date` is slow.
const { getPrototypeOf, keys: getOwnKeys } = Object;
const objectPrototype = Object.prototype;
const { isArray } = Array;
const { isView: isArrayBufferView } = ArrayBuffer;
const DateClass = Date;
const RegExpClass = RegExp;
const MapClass = Map;
const SetClass = Set;

// A plain object created in another vm context has that context's Object.prototype. We still treat it as plain.
const isPlainObjectPrototype = (prototype: object | null): boolean => prototype === objectPrototype || prototype === null || getPrototypeOf(prototype) === null;

const isPlainObject = (value: object): boolean => isPlainObjectPrototype(getPrototypeOf(value));

const isBsonValue = (value: object): value is { _bsontype: string } => typeof (value as { _bsontype?: unknown })._bsontype === 'string';

// ObjectId, Decimal128, Long, etc. can't be changed, so sharing them is safe. Binary (and UUID) hold bytes that can change, so we copy them.
const copyBsonValue = (value: { _bsontype: string }): unknown => {
    if (value._bsontype !== 'Binary') return value;

    const binary = value as BinaryLike;
    const BinaryClass = binary.constructor as new (bytes: Uint8Array, subType: number) => unknown;
    return new BinaryClass(Uint8Array.from(binary.value()), binary.sub_type);
};

const copyArrayBufferView = (value: ArrayBufferView): ArrayBufferView => {
    if (Buffer.isBuffer(value)) return Buffer.from(value);
    if (value instanceof DataView) return new DataView(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));

    const TypedArrayClass = value.constructor as new (source: ArrayBufferView) => ArrayBufferView;
    return new TypedArrayClass(value);
};

const copyPopulateOptions = (options?: PopulateOptions): PopulateOptions | undefined => {
    if (!options) return options;

    // Spread keeps symbol keys, which mongoose uses to remember the populated model.
    const copy = { ...options };
    for (const key of POPULATED_DOCUMENT_REFERENCES) delete copy[key];
    return copy;
};

/**
 * toObject() turns populated documents into plain objects. This puts a copy of each populated document back into
 * `raw`, so the new document gets real populated documents, like the original has.
 */
const restorePopulatedDocuments = (source: unknown, raw: unknown, copies: CopiedObjects): unknown => {
    if (source === null || typeof source !== 'object' || raw === null || typeof raw !== 'object') return raw;

    if (isMongooseDocument(source)) {
        const document = source as DocumentInternals;
        if (!document.$isSubdocument) return cloneDocument(document, copies);
        restorePopulatedDocumentsInObject(document._doc, raw as Record<string, unknown>, copies);
    } else if (isArray(source)) {
        const rawItems = raw as unknown[];
        source.forEach((item, index) => {
            rawItems[index] = restorePopulatedDocuments(item, rawItems[index], copies);
        });
    } else if (source instanceof MapClass) {
        const rawEntries = raw as Record<string, unknown>;
        for (const [key, value] of source) rawEntries[key] = restorePopulatedDocuments(value, rawEntries[key], copies);
    } else if (isPlainObject(source)) {
        restorePopulatedDocumentsInObject(source as Record<string, unknown>, raw as Record<string, unknown>, copies);
    }

    return raw;
};

const restorePopulatedDocumentsInObject = (source: Record<string, unknown>, raw: Record<string, unknown>, copies: CopiedObjects): void => {
    for (const key of getOwnKeys(source)) {
        if (key in raw) raw[key] = restorePopulatedDocuments(source[key], raw[key], copies);
    }
};

/**
 * Copies a document the same way mongoose builds one from a query result: same class, same projection, and init()
 * instead of set(), so nothing is marked as modified and unselected fields don't get defaults. Then it restores
 * which paths are populated. The copy shares nothing with the original: not the data, not the populated documents,
 * not `$locals` and not the session.
 */
const cloneDocument = (source: DocumentInternals, copies: CopiedObjects): DocumentInternals => {
    const known = copies.get(source);
    if (known) return known as DocumentInternals;

    const options: Record<string, unknown> = { skipId: true, isNew: false, willInit: true };
    if (source.$__.strictMode != null) options.strict = source.$__.strictMode;

    const DocumentClass = source.constructor as DocumentConstructor;
    const copy = new DocumentClass(undefined, source.$__.selected, options);
    copies.set(source, copy);

    const raw = source.toObject(RAW_SNAPSHOT_OPTIONS) as Record<string, unknown>;
    const populatedPaths = Object.entries(source.$__.populated ?? {});
    if (populatedPaths.length > 0) {
        restorePopulatedDocumentsInObject(source._doc, raw, copies);
        // This must happen before init(): init() only keeps lean-populated values as plain objects if it knows the path is populated.
        for (const [path, { value, options: populateOptions }] of populatedPaths) {
            copy.populated(path, detachCachedValue(value, copies), copyPopulateOptions(populateOptions));
        }
    }

    copy.init(raw);
    if (source.$$populatedVirtuals) copy.$$populatedVirtuals = detachCachedValue(source.$$populatedVirtuals, copies);
    copy.isNew = source.isNew;

    return copy;
};

const copyPlainObject = (value: Record<string, unknown>, prototype: object | null, copies: CopiedObjects): Record<string, unknown> => {
    const copy: Record<string, unknown> = prototype === objectPrototype ? {} : Object.create(prototype);
    copies.set(value, copy);
    for (const key of getOwnKeys(value)) copy[key] = detachCachedValue(value[key], copies);
    return copy;
};

/**
 * Makes a deep copy of a cached value, so that nothing in the copy can change the original. Documents keep their
 * projection and populated paths, plain data is copied, and values that can't change (like ObjectId) are reused.
 * Objects of unknown classes are returned unchanged.
 */
export const detachCachedValue = <T>(value: T, copies: CopiedObjects = new WeakMap()): T => {
    if (value === null || typeof value !== 'object') return value;

    const known = copies.get(value);
    if (known !== undefined) return known as T;

    // Plain objects and arrays first: cached results are mostly made of them.
    const prototype = getPrototypeOf(value);
    if (prototype === objectPrototype || prototype === null) return copyPlainObject(value as Record<string, unknown>, prototype, copies) as T;

    if (isArray(value)) {
        const copy: unknown[] = [];
        copies.set(value, copy);
        for (const item of value) copy.push(detachCachedValue(item, copies));
        return copy as T;
    }

    if (isMongooseDocument(value)) {
        const document = value as unknown as DocumentInternals;
        // Subdocuments are never cached on their own. If one shows up anyway, return a plain copy.
        return (document.$isSubdocument ? document.toObject(RAW_SNAPSHOT_OPTIONS) : cloneDocument(document, copies)) as T;
    }

    if (isBsonValue(value)) return copyBsonValue(value) as T;
    if (value instanceof DateClass) return new DateClass(value.getTime()) as T;
    if (isArrayBufferView(value)) return copyArrayBufferView(value) as T;
    if (value instanceof RegExpClass) return new RegExpClass(value.source, value.flags) as T;

    if (value instanceof MapClass) {
        const copy = new MapClass();
        copies.set(value, copy);
        for (const [key, item] of value) copy.set(key, detachCachedValue(item, copies));
        return copy as T;
    }

    if (value instanceof SetClass) {
        const copy = new SetClass();
        copies.set(value, copy);
        for (const item of value) copy.add(detachCachedValue(item, copies));
        return copy as T;
    }

    if (isPlainObjectPrototype(prototype)) return copyPlainObject(value as Record<string, unknown>, prototype, copies) as T;

    return value;
};

/** True when `shareCachedInstances` is on, so cached reads return the same object instead of a copy. */
export const shouldShareCachedInstances = (): boolean => getConfig()?.shareCachedInstances === true;

/** Returns a copy of the value for storing in or reading from the in-memory cache, unless copying is turned off. */
export const isolateCachedValue = <T>(value: T): T => (shouldShareCachedInstances() ? value : detachCachedValue(value));
