# Release Process

This project uses [Changesets](https://github.com/changesets/changesets) to manage versioning and publishing.

## Creating a Changeset

When you make changes that should trigger a version bump, create a changeset:

```bash
yarn changeset
```

This will prompt you to:

1. Select which packages have changed
2. Choose the version bump type (major, minor, patch)
3. Write a summary of the changes

The changeset will be saved in `.changeset/` directory and should be committed with your changes.

## Version Bump Types

| Type | Version Change | When to Use |
| ---- | -------------- | ----------- |
| **Major** | 1.0.0 → 2.0.0 | Breaking changes |
| **Minor** | 1.0.0 → 1.1.0 | New features, backwards compatible |
| **Patch** | 1.0.0 → 1.0.1 | Bug fixes, backwards compatible |

## Releasing

### 1. Version Packages

```bash
yarn version
```

This will:

- Consume all changesets
- Update package versions
- Update CHANGELOG.md
- Create a commit with the changes

### 2. Review Changes

Review the version bumps and changelog updates, then commit:

```bash
git add .
git commit -m "chore: version packages"
```

### 3. Publish to npm

```bash
yarn release
```

This will:

- Build all packages
- Publish to npm
- Create git tags

### 4. Push to Remote

```bash
git push --follow-tags
```

## NPM Authentication

Before publishing, ensure you're logged in to npm:

```bash
npm login
```

Or set up an `.npmrc` file with your authentication token:

```
//registry.npmjs.org/:_authToken=YOUR_TOKEN
```

## CI/CD Integration

For automated releases, you can use GitHub Actions:

```yaml
name: Release

on:
  push:
    branches:
      - main

jobs:
  release:
    name: Release
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v3
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'yarn'

      - name: Install dependencies
        run: yarn install --immutable

      - name: Create Release Pull Request or Publish
        uses: changesets/action@v1
        with:
          publish: yarn release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## Published Packages

The following packages are published to npm:

| Package | npm Name |
| ------- | -------- |
| `packages/sdk` | `@substancelabs/aztec-evm-bridge-sdk` |

Other packages (`deploy`, `filler`, `e2e`, `bridge-app`) are private and not published.
