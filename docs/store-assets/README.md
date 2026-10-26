# Chrome Web Store assets

Refreshed on 2026-10-26 with the current SVG logo. [Screenshot provenance](../screenshots/README.md): a real Chrome rendering of an isolated candidate build, with a local preview fixture containing nine NASA lunar-flyby image URLs. The visible Preview badge identifies this as a demonstration. English shows two manual selections; Chinese shows zero. No downloads were started.

The 3200×2400 native 4× screenshots in `docs/screenshots/` were uniformly reduced to 1024×768 and centered on a 1280×800 neutral canvas. No interface content was painted over or composited into the screenshots. These assets replace the earlier images in the repository; submitted Store assets and existing release packages are unchanged.

Imagery credit: NASA. Third-party image rights remain with their owners. These examples do not imply NASA endorsement. See https://www.nasa.gov/nasa-brand-center/images-and-media/.

The 440×280 promotional tile is generated from the current SVG logo and name. [`promo-440x280.svg`](promo-440x280.svg) is the scalable version; `promo-440x280.png` is its Store-compatible export. Regenerate both with `npm run icons`.
