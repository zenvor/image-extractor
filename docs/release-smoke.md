# Manual Chrome acceptance for the first release candidate

Current source version: 1.1.0. Run these checks against the exact built package intended for release. Unit tests and Node HTTP integration tests do not substitute for actual Chrome behavior.

## Preparation

1. Finish any active downloads before replacing or reloading the installed extension.
2. Load the verified candidate at `.output-staged/chrome-mv3`, or synchronize it to the existing unpacked installation and reload that installation manually. Do not leave duplicate extension instances enabled.
3. Confirm version 1.1.0 and that Download policy uses the five-step slider. Verify the installed build as well; version text alone does not prove its contents.
4. From the project root, start the local fixtures: `python3 examples/release-smoke.py`.
5. Open `http://127.0.0.1:8197` in Chrome. The fixtures use local SVG files, not external image hosts. Request counters distinguish image previews from other requests using Sec-Fetch-Dest; they are diagnostic counts, not measured network concurrency.

## Check scenarios

- **Normal download and language:** Extract the three local images, download them, verify ZIP contents, then switch English/Chinese in the header. Changing language must not reset selection or a running task.
- **Outcome progress:** Check violet successful, amber failed and gray pending segments against task counts; zero-item tasks must not produce invalid percentages. Packing/saving must stay indeterminate until saving is confirmed. Retry updates must move outcomes without restarting neighboring tasks. Partial results with a saved ZIP must be warning-colored, unsaved failures red, and cancellation neutral. Verify ZIP filenames, source URLs and full causes are directly available in the row, long failure lists remain keyboard-scrollable, and the sole folder button above the table opens the default downloads folder.
- **Responsive task rows:** Check English and Chinese at desktop, tablet and 320px-wide viewport sizes. Each task must use one row, retain task/source, status/progress, results and actions, wrap on narrow screens without horizontal scrolling, and show full filenames, source URLs and errors directly in the row. Resize or change language during a disposable controlled transfer; it must not restart or cancel.
- **Shared download manager:** Start controlled downloads from five separate tabs. They must reuse one manager page, keep five distinct batches and show every task's progress. Opening Download task from a page with no task must reuse that overview. Cancel one batch and verify the other controllers continue; resume or retry one batch without restarting its neighbors. Closing the manager interrupts all its active batches, so only do this with disposable test tasks after verifying no user downloads are running. Older per-batch pages should remain viewable without taking ownership.
- **Failed-only retry:** Open `/retry`, clear counters, and download all three images. Two should succeed and the retry image should fail with controlled HTTP 404. Select Repair failed image on the webpage, then retry only failed images in the extension. Refresh request counters: successful images must not be fetched again. Verify the supplementary ZIP contains only the failed image with its original path and number.
- **Cancel and resume:** Open `/resume`, clear counters, and start all six images. Four complete quickly; two take about 36 seconds. Cancel while slow images are still transferring, then continue the incomplete task. Completed cached images should be reused; interrupted files should be requested again. Verify the resulting ZIP.
- **Page isolation:** While `/resume` is running, open `/page-b` in another tab and open the extension there. It should show that page's independent image and controls rather than inherit the first page's progress.
- **Page images and original matching:** Confirm matching is off on a newly analyzed page, only discovered page URLs are shown and none is selected, enabling matching shows only rule matches, and an unsupported page shows an empty state. Returning to page images restores its results and explicit choices without selecting new images. Re-extraction starts unselected; reopening cached results retains manual choices. Verify legacy automatic selections do not become batch download choices. Turning off all Other image sources must still extract ordinary images.
- **Popup bounds:** With a running download, progress must not add a sidebar scrollbar. Export TXT and check the toast does not create horizontal or vertical window scrollbars. Repeat in English and Chinese, including failed/resumable tasks. Format tags should match the compact card badges.
- **Slider:** Verify five discrete positions, Medium by default unless a prior preference exists, keyboard arrows/Home/End, and restoring the saved value after reopening.

If a problem occurs, record the scenario, displayed message, ZIP contents, and request counters. Do not mark this checklist passed solely from unit tests or HTTP fixture self-checks.

Stop the local fixture server with Ctrl+C after acceptance. No scheduled monitoring is required.

## Duitang matching acceptance (2026-10-25, version 0.6.7)

- Inspected actual list `img.src`/`currentSrc`, detail preview sources and the detail page's original-image link in Chrome. Both 400px and 1000px previews use `x-image-process`; the original retains the `a-ho-img.dtstatic.com` hostname and path without that parameter.
- Two source images directly opened and decoded at 2360 × 5120 and 4000 × 4000. All 24 captured list-image URLs passed the resolver check; this is not a claim that every original was fetched or validated.
- With zero active downloads, synchronized and reloaded 0.6.7. The category popup displayed 24 matched originals and zero selections; its first preview showed the same original URL as the actual detail page.
- Screenshot and DOM samples were retained locally under the ignored `.output-staged` directory. No new batch ZIP download was started.

## Manual selection acceptance (2026-10-25, version 0.6.6)

- Chrome confirmed Reloaded and version 0.6.6; the shared manager had 19 historical tasks and 0 active downloads.
- NASA's real lunar-flyby gallery produced 201 discovered URLs. New results had zero checked images and disabled bulk download, copy and TXT actions.
- With `art002e009` filtering 21 results, individual choices changed the download count to 1 and 2. Select all selected those 21 results. Enabling original matching on this unsupported page showed zero matches without enabling bulk download; Deselect all could still clear the hidden choices. Returning to page images retained zero selections.
- A manually selected image and the English language survived closing and reopening the popup. Re-extraction cleared the image selection. The interface language was restored to Simplified Chinese afterward.
- Astra's screenshot review identified hidden unchecked controls; these now remain visible before hover, and both screenshots were recaptured from the reloaded build.
- Original-size English and Chinese screenshots are stored in [screenshots](screenshots/README.md). These checks started no image download and do not replace the separate transfer/save scenarios above.

## Inline task information acceptance (2026-10-25)

- Chrome reported Reloaded; overview retained 19 historical tasks and 0 active. Exactly one global folder button is present above the table, with no task-details buttons. Clicking it opened Finder Downloads.
- Actual rows show ZIP filenames, full source URLs and failure causes, including historical HTTP 503 and timeout errors. Long failure lists have their own bounded scrolling area. Bright amber indicators and pale warning badges were visually confirmed.
- Screenshot evidence was retained locally. No new image transfer was started for this visual check; active stage transitions and narrow-screen real-browser checks remain pending.

## Version 1.0.0 Chrome smoke (2026-10-25)

- Release checks passed all 390 automated tests, type checking, production build, bundle validation and ZIP integrity checks. The initial sandbox denied two loopback HTTP cases; those cases were rerun successfully outside it.
- Confirmed the existing loaded 0.6.7 manager had 20 historical tasks and zero active downloads before replacement. Backed up the loaded build under the ignored candidate directory, copied the exact candidate files and confirmed Chrome reported Reloaded and version 1.0.0. User task storage was not cleared.
- On the local normal-download fixture, the actual popup showed three SVG images and zero initial selections. Select all enabled download for exactly three images.
- Chrome reported the saved ZIP as Done (1,225 bytes). Independently opened that exact saved file, verified ZIP CRC and the three SVG entries: 001_a.svg, 002_b.svg and 003_c.svg.
- This smoke does not yet establish final-build failed-only retry, cancellation/recovery, five-page isolation, narrow-screen behavior or refreshed store screenshots. Earlier version acceptance and automated checks remain separately documented.

- Final 1.0.0 failed-only retry: first ZIP contained a.svg, b.svg and the failure report; after repairing the controlled HTTP 404, the supplementary ZIP contained only 003_retry.svg. Download request counts for a and b remained one each; retry rose from two (including its automatic retry) to three. Both ZIP CRCs passed.
- Final 1.0.0 cancellation/recovery: cancelled after four of six files completed, then resumed the same task. Chrome saved a six-SVG ZIP; CRC and SVG content passed. Four completed files were each requested once; only the two interrupted slow files were requested twice.
- During resumed transfer, page B showed its own one-image result and zero initial selections. Chinese interface preference restored afterward. No active downloads remained.
- Real NASA-gallery screenshots refreshed from version 1.0.0 in both languages; store dimensions and preparation are documented in store-assets/README.md. Five-page simultaneous transfers and narrow-screen manual checks remain unverified; automated coverage is retained.

## Version 1.1.0 release checks (2026-10-26)

- All 428 automated tests in 22 files, type checking, the isolated production build and production-bundle checks passed. An earlier run hit the existing accelerated timing assertion; the complete rerun passed without changing the assertion.
- The separate Chrome parser harness passed all eleven provider fixtures and the inert-HTML fixture (12/12). Real saved HTML produced original URLs for Vipr, Pixhost and ImageTwist. This does not establish image-download acceptance for every provider; see [host validation boundaries](hosted-images.md#validation-boundaries).
- [Release workflow 40243025730](https://github.com/zenvor/image-extractor-extension/actions/runs/40243025730) completed successfully for tag `v1.1.0`, commit `f0a956499033076ca515e7c5bb3b764459a37c0d`.
- Downloaded the public release ZIP and checked its checksum, all 35 ZIP entries, manifest version 1.1.0 and bundled license notices. Size: 337931 bytes; SHA-256: `d0d8b50e69e96a3b4060f91826ec72eb71c11b07e36c5c8a2f9133f7c51dc361`.
- The existing installed extension was not reloaded. GitHub publication did not update the previously submitted Chrome Web Store package.
