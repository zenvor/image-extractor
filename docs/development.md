# Development

React, TypeScript, WXT, Tailwind CSS, and locally bundled shadcn/ui components.

```sh
npm ci
npm run typecheck
npm test -- --maxWorkers=1
npm run build
npm run check:bundle
```

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
