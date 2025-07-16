module.exports = {
  branches: ['master'],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    ['@semantic-release/changelog', {
      changelogFile: 'CHANGELOG.md',
    }],
    '@semantic-release/npm',
    ['@semantic-release/github', {
        assets: [
          ['package.json', 'yarn.lock', 'CHANGELOG.md'],
        ],
    }],
  ],
};
