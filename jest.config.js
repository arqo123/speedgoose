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
    testPathIgnorePatterns: ['/node_modules/', '<rootDir>/test/redis/'],
    maxWorkers: '25%',
};
