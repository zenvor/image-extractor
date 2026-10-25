# Image Extractor 1.0.0 — First stable release

[GitHub Release 1.0.0](https://github.com/zenvor/image-extractor-extension/releases/tag/v1.0.0) is published with the Chrome extension ZIP and SHA-256 checksum. The Chrome Web Store submission was last verified as pending review on 2026-10-25, with automatic publication after approval enabled. Core Chrome download, failed-only retry, cancellation/recovery and two-page isolation smoke checks passed; five-page simultaneous transfers and narrow-screen manual checks remain unverified.

Extract webpage images, resolve original URLs from supported thumbnails, and save selected images as ZIP archives.

## Changes in 1.0.0

- Prepare the first stable release with all image extraction and original-matching features available free of charge. No payment, account or sponsorship integration is included.
- Consolidate store listing, permission justifications and submission prerequisites in CHROMEWEBSTORE.md. This version has been submitted; approval is pending.

## Changes in 0.6.8

- Match the popup workspace to extract.pics' live result-canvas background, `oklch(0.967 0.001 286.375)`. Both sidebar and image canvas use one shared surface token; the header, white cards and layout remain unchanged.
- Candidate production build and bundle checks pass. The reference color was read from the live site's computed style after extraction. Installed Chrome reload and visual acceptance remain unverified because its internal pages displayed blank during this check; no reload was attempted without confirming download state.

## Changes in 0.6.7

- Update Duitang blog-image matching for `a-ho-img.dtstatic.com` previews: remove `x-image-process` while preserving the CDN hostname, unrelated query bytes and fragments. Legacy thumbnail suffixes no longer rewrite the hostname to `duitang.com`.
- Exclude avatars and non-image URLs from this rule. Already-original blog images remain matched, and several previews deduplicate to one original.
- Bump the resolver version so existing cached results are refreshed.
- Chrome DOM inspection confirmed the same original links on two actual detail pages. Directly opened originals were 2360 × 5120 and 4000 × 4000; this verifies these examples, not every image on Duitang. README screenshots remain the real 0.6.6 captures documented with them.

## Changes in 0.6.6

- Extraction and HTML import start unselected. Users choose individual images or select all; switching original-matching mode preserves manual choices without adding selections.
- Unchecked image controls remain visible, so individual selection is discoverable before hovering.
- Cached automatic selections no longer count as user choices. Popup, batch tools and download validation use the same current-mode scope; single-image actions remain independent of bulk selection.
- Batch results show found and selected counts separately, and explain where to choose images before downloading.
- Imported HTML tasks retain source webpage metadata for display and retries without changing their workspace isolation key.
- Real Chrome screenshots are included in both READMEs.

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

The 1.0.0 candidate passed type checking, production build, bundle checks, icon/description validation and ZIP CRC checks. All 390 tests passed: 388 inside the sandbox, with two real-loopback HTTP tests rerun outside it after the sandbox denied binding to 127.0.0.1. Core final-package Chrome smoke checks passed, including native saving, failed-only retry, cancellation/recovery and two-page isolation. Five-page simultaneous transfers and narrow-screen manual checks remain unverified; Chrome Web Store review is pending.

All 390 tests in 21 files pass, including real loopback HTTP/disk-stream checks for continuous transfers, failed-only retry and cancellation recovery. Type checking, candidate production build and production-bundle checks pass. Manager tests cover five pages, independent controllers, shared page reuse, language changes, permission revocation, page unload, and stale snapshot updates.

Version 0.6.7 was synchronized and reloaded in Chrome after confirming zero active downloads. On Duitang's wallpaper category page, the popup showed 24 matched originals and zero selections; the first preview's original address exactly matched the detail page's CDN link without processing parameters. All 24 captured list URLs passed the resolver check. Two directly opened originals decoded at 2360 × 5120 and 4000 × 4000. No batch ZIP download was started for this check.

Version 0.6.6 was synchronized and reloaded in Chrome with no active downloads. Real NASA-gallery acceptance verified zero initial selections, individual selection, selecting visible results, clearing selections hidden by a mode change, restoring manual choices and English after reopening, and clearing choices on re-extraction. English and Chinese screenshots are included in the READMEs. No new image download was started during this selection check.

The brand-violet/amber theme, warning badges, compact row feedback and recovery-first actions were synchronized, reloaded and visually inspected in Chrome with 19 historical tasks and 0 active downloads. Historical partial tasks visibly retain proportional success/failure segments. Full outcome ratios, phase feedback and failure details are covered by simulated DOM tests. No new download was started for this visual check; real multi-page transfers, native saving and narrow-screen browser acceptance remain separate checks.

The task overview now shows ZIP filenames, full source URLs and full image failure causes directly within each row. Long failure lists scroll within the row; detail dialogs and per-row folder buttons were removed. One global downloads-folder button above the table was verified in Chrome to open Finder Downloads. Warning indicators now use the brighter Tailwind amber palette through global theme tokens, with dark text and indicator outlines for contrast. This refinement passed full tests, type checking, production build and bundle checks, then was synchronized and reloaded with no active downloads.
