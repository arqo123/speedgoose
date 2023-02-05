module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    setupFilesAfterEnv: ['./test/setupTestEnv.ts'],
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
