// Tests against a real Redis server (REDIS_URI). Run with: yarn test:redis
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['<rootDir>/test/redis/**/*.redis.test.ts'],
    globalTeardown: './test/dbTeardown.js',
    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                isolatedModules: true,
            },
        ],
    },
    testTimeout: 60000,
};
