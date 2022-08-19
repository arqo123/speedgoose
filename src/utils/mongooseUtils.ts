import {Model, Document, Mongoose} from "mongoose";
import mpath from 'mpath'
import Container from "typedi";
import {GlobalDiContainerRegistryNames} from "../types/types";

export const isResultWithId = (value: unknown): boolean => {
    return value && typeof value === 'object' && value['_id']
};

export const isArrayOfObjectsWithIds = (value: unknown): boolean => {
    if (Array.isArray(value)) {
        return value[0] && typeof value[0] === 'object' && value[0]['_id']
    } return false
};

export const isResultWithIds = (result: unknown): boolean => isArrayOfObjectsWithIds(result) || isResultWithId(result)

export const getValueFromDocument = <T>(pathToValue: string, record: Document<T>): unknown =>
    mpath.get(pathToValue, record)

export const setValueOnDocument = <T>(pathToValue: string, valueToSet: unknown, record: Document<T>): void =>
    mpath.set(pathToValue, valueToSet, record)

//@ts-expect-error from mongoose document constructor we can get modelName
export const getMongooseModelNameFromDocument = <T>(record: Document<T>): string => record.constructor.modelName

export const getMongooseModelFromDocument = <T>(record: Document): Model<T> => getMongooseInstance().models[getMongooseModelNameFromDocument(record)]

export const getMongooseModelByName = <T>(mongooseModelName: string): Model<T> => getMongooseInstance().models[mongooseModelName]

export const getMongooseInstance = (): Mongoose =>
    Container.get<Mongoose>(GlobalDiContainerRegistryNames.MONGOOSE_GLOBAL_ACCESS)
