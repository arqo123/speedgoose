module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  setupFilesAfterEnv: ["./test/setupTestEnv.ts"],
  "globals" : {
    "ts-jest": {
      "isolatedModules" : true,
    }
  } 
};