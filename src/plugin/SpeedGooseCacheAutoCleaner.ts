import {Schema} from "mongoose";
import {publishRecordIdOnChannel} from "../redisUtils";
import {MongooseDocumentEvents, MongooseDocumentEventsContext, SpeedGooseCacheAutoCleanerOptions, SpeedGooseRedisChannels} from "../types/types";
import {getMongooseModelFromDocument} from "../utils";
import {wasRecordDeleted} from "./utils";

const appendPreSaveListener = (schema: Schema, options: SpeedGooseCacheAutoCleanerOptions): void => {
    schema.pre('save', {document: true}, async function (next) {
        this.$locals.wasNew = this.isNew
        this.$locals.wasDeleted = wasRecordDeleted(this, options)
        const model = getMongooseModelFromDocument(this)

        await publishRecordIdOnChannel(SpeedGooseRedisChannels.SAVED_DOCUMENTS, String(this._id))
        model.emit(MongooseDocumentEvents.BEFORE_SAVE, <MongooseDocumentEventsContext>{record: this, wasNew: this.isNew, wasDeleted: this.$locals.wasDeleted, modelName: model.modelName})
        next()
    })
}

const appendPostSaveListener = (schema: Schema): void => {
    schema.post('save', {document: true}, async function (record, next) {
        const wasNew = this.$locals.wasNew
        const wasDeleted = this.$locals.wasDeleted
        const model = getMongooseModelFromDocument(record)

        model.emit(MongooseDocumentEvents.AFTER_SAVE, <MongooseDocumentEventsContext>{record, wasNew, wasDeleted, modelName: model.modelName})
        next()
    })
}

const appendPostRemoveListener = (schema: Schema): void => {
    schema.post('remove', {document: true}, async function (record, next) {
        const model = getMongooseModelFromDocument(record)

        await publishRecordIdOnChannel(SpeedGooseRedisChannels.REMOVED_DOCUMENTS, String(record._id))
        model.emit(MongooseDocumentEvents.AFTER_REMOVE, <MongooseDocumentEventsContext>{record, wasDeleted: true, modelName: model.modelName})
        next()
    })
}

const speedGooseEventListeners = (schema: Schema, options: SpeedGooseCacheAutoCleanerOptions): void => {
    appendPreSaveListener(schema, options)
    appendPostSaveListener(schema)
    appendPostRemoveListener(schema)
}

const isListenerPluginRegisteredForSchema = (schema: Schema): boolean =>
    schema.plugins.some(plugin => plugin?.fn.name === speedGooseEventListeners.name)

export const SpeedGooseCacheAutoCleaner = (schema: Schema, options: SpeedGooseCacheAutoCleanerOptions): void => {
    //* Note: This is special logic to avoid duplicating listeners for given events */
    if (!isListenerPluginRegisteredForSchema(schema)) {
        schema.plugin(speedGooseEventListeners, options)
    }
}
