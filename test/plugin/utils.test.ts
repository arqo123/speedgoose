
import * as commonUtils from "../../src/utils/commonUtils"
import *as  pluginUtils from "../../src/plugin/utils"
import {getMongooseTestModel} from "../testUtils"

const mockedGetConfig = jest.spyOn(commonUtils, 'getConfig')

const mockedLeanQuery = ()=> ({lean : () => ({})})

describe(`getRecordAffectedByAction`, () => {
    test(`should not add multitenancyKey to projection if it was not set in config`, async () => {
        mockedGetConfig.mockReturnValue({})
        const model = getMongooseTestModel()
        const query = model.findOneAndDelete({someFiltrationKey: 'value'})
        const mockedFindOne = jest.spyOn(model, 'findOne')
        //@ts-expect-error  mocking query result to not make a call to db
        mockedFindOne.mockImplementation(mockedLeanQuery)

        await pluginUtils.getRecordAffectedByAction(query)
        expect(mockedFindOne).toBeCalledWith({someFiltrationKey: 'value'}, {_id: 1}, {})
    })

    test(`should add multitenancyKey to projection if it was set in config`, async () => {
        mockedGetConfig.mockReturnValue({multitenancyConfig : {multitenantKey : 'tenantKey'}})
        const model = getMongooseTestModel()
        const query = model.findOneAndDelete({someFiltrationKey: 'value'})
        const mockedFindOne = jest.spyOn(model, 'findOne')
        //@ts-expect-error  mocking query result to not make a call to db
        mockedFindOne.mockImplementation(mockedLeanQuery)

        await pluginUtils.getRecordAffectedByAction(query)
        expect(mockedFindOne).toBeCalledWith({someFiltrationKey: 'value'}, {_id: 1, tenantKey: 1}, {})
    })
})