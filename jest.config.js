module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    setupFilesAfterEnv: ['./test/setupTestEnv.ts'],
    globalTeardown: './test/dbTeardown.js',
    transform: {
        '^.+\\.(t|j)s$': [
            'ts-jest',
            {
                isolatedModules: true,
            },
        ],
    },
    maxWorkers: '25%',
};
