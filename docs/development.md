# Development

React, TypeScript, WXT, Tailwind CSS, and locally bundled shadcn/ui components.

```sh
npm ci
npm run typecheck
npm test -- --maxWorkers=1
npm run build
npm run check:bundle
```

## Dependency installation

Use `npm ci` to reproduce the committed dependency tree for a fresh source build or CI run. It requires `package-lock.json`, fails if it disagrees with `package.json`, removes an existing `node_modules` directory, and does not rewrite either manifest or lockfile.

Use `npm install` for everyday dependency changes, such as `npm install <package>`. It also uses the lockfile when its versions satisfy `package.json`, but may update the lockfile when dependency requirements change. Review and commit intentional changes to both files.

A lockfile helps reproduce dependencies; it does not pin Node.js, npm, operating-system libraries or every aspect of the build environment. See the official [npm ci](https://docs.npmjs.com/cli/commands/npm-ci/) and [npm install](https://docs.npmjs.com/cli/commands/npm-install/) documentation.

## Checks and isolated builds

The full test suite includes a local HTTP streaming test and needs permission to listen on loopback. For offline tests without a local listener:

```sh
npm test -- --exclude tests/archive-network.test.ts --maxWorkers=1
```

To build a candidate without replacing the usual build directory:

```sh
node --input-type=module -e 'import { build } from "wxt"; await build({outDir:".output-staged"});'
EXTENSION_BUILD_DIR=.output-staged/chrome-mv3 npm run check:bundle
```

Use `npm run icons` to regenerate icons. Original URL rules live in `lib/originalImageResolver.js` and `lib/legacyOriginalRules.js`; update their version and regression fixtures when rules change. Commits, PR titles, and release notes use English; commits follow Conventional Commits.

[Manual Chrome acceptance](release-smoke.md) · [Release notes](release-notes.md) · [Download policy](download-policy.md)

The extension builds and tests independently; no sibling crawler project or server is required. See the [crawler feature comparison](../FEATURE_PARITY.md) for migration boundaries.

Release titles and notes are written manually; see [publishing release assets](releasing.md).
