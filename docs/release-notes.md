# Image Extractor 0.6.5 — First public release candidate

Draft release notes. The package is prepared locally; this is not a published release. Full Chrome download acceptance is pending.

Extract webpage images, resolve original URLs from supported thumbnails, and save selected images as ZIP archives.

## Included

- Current-page extraction, batches of URLs, and local HTML import.
- Page-image extraction by default, with opt-in original URL matching for supported sites including IMX aliases; unmatched pages show an explicit empty state in matching mode.
- Image filters, uncropped previews, grid/list views, and keyboard selection.
- ZIP downloads with failed-only retries and checked, file-based cache recovery.
- One shared download manager for all webpages, with aligned task rows on desktop and wrapped rows on narrow screens. Independent live progress, cancellation, retries and recovery per task; ZIP filenames, full source URLs and failure causes directly in each row, plus one global downloads-folder button. Sidebar utility buttons use consistent icons.
- Outcome-aware progress: successful, failed and pending images use brand violet, amber and gray segments with text counts. Packing and saving retain indeterminate feedback. Saved partial results use warning badges, unsaved failures remain destructive, and cancellation is neutral. The overview has tighter spacing, brief row feedback and recovery-first actions.
- Five download policies with shared concurrency, request spacing measured from actual transfer starts, and server cooldown. Completed or cancelled transfers release their slots without waiting for the remaining pacing interval.
- Independent page tasks and English / Simplified Chinese interfaces.
- Standalone build and tests, MIT licensing, and bundled third-party license notices.

## Install

Unzip the Chrome package, open chrome://extensions, enable Developer mode, and load its directory as an unpacked extension. Chrome 120 or newer is required. Wait for active downloads to finish before replacing or reloading an existing installation.

## Boundaries

Original matching depends on supported URL patterns and does not verify original resolution during extraction. Website verification must be completed by the user. Recovery reuses completed cached files; it is not byte-level HTTP Range resume. Download limits cannot guarantee that a website will not throttle requests.

## Validation

All 373 tests in 21 files pass, including 41 scheduler tests, 76 popup tests, 15 shared-manager tests, and real loopback HTTP/disk-stream checks for continuous transfers, failed-only retry and cancellation recovery. Type checking, candidate production build and production-bundle checks pass. Manager tests cover five pages, independent controllers, shared page reuse, language changes, permission revocation, page unload, and stale snapshot updates.

The brand-violet/amber theme, warning badges, compact row feedback and recovery-first actions were synchronized, reloaded and visually inspected in Chrome with 19 historical tasks and 0 active downloads. Historical partial tasks visibly retain proportional success/failure segments. Full outcome ratios, phase feedback and failure details are covered by simulated DOM tests. No new download was started for this visual check; real multi-page transfers, native saving and narrow-screen browser acceptance remain separate checks.

The task overview now shows ZIP filenames, full source URLs and full image failure causes directly within each row. Long failure lists scroll within the row; detail dialogs and per-row folder buttons were removed. One global downloads-folder button above the table was verified in Chrome to open Finder Downloads. Warning indicators now use the brighter Tailwind amber palette through global theme tokens, with dark text and indicator outlines for contrast. This refinement passed full tests, type checking, production build and bundle checks, then was synchronized and reloaded with no active downloads.
