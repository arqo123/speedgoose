module.exports = {
  "branches": [
    "master",
    {
      "name": "next",
      "prerelease": true
    }
  ],
  "plugins": [
    ["@semantic-release/commit-analyzer", {
      "preset": "conventionalcommits",
      "releaseRules": [
        {"type": "build", "scope": "deps", "release": "patch"},
        {"type": "fix", "scope": "deps", "release": "patch"},
        {"type": "build", "release": "patch"},
        {"type": "fix", "release": "patch"}
      ],
      "parserOpts": {
        "noteKeywords": ["BREAKING CHANGE", "BREAKING CHANGES"]
      }
    }],
    "@semantic-release/release-notes-generator",
    "@semantic-release/npm",
    "@semantic-release/github",
    [
      "@semantic-release/changelog",
      {
        "changelogFile": "CHANGELOG.md"
      }
    ],
    [
      "@semantic-release/git",
      {
        "assets": [
          "package.json",
          "package-lock.json",
          "CHANGELOG.md"
        ],
        "message": "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}"
      }
    ]
  ]
}