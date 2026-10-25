# Manual Chrome acceptance for the first release candidate

Current source version: 0.6.5. Run these checks against the exact built package intended for release. Unit tests and Node HTTP integration tests do not substitute for actual Chrome behavior.

## Preparation

1. Finish any active downloads before replacing or reloading the installed extension.
2. Load the verified candidate at `.output-staged/chrome-mv3`, or synchronize it to the existing unpacked installation and reload that installation manually. Do not leave duplicate extension instances enabled.
3. Confirm that Download policy uses the five-step slider. The version remains 0.6.5, so version text alone does not prove the new build is loaded.
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
- **Page images and original matching:** Confirm matching is off on a newly analyzed page, only discovered page URLs are shown, enabling matching shows only rule matches, and an unsupported page shows an empty state. Returning to page images restores its results. Turning off all Other image sources must still extract ordinary images.
- **Popup bounds:** With a running download, progress must not add a sidebar scrollbar. Export TXT and check the toast does not create horizontal or vertical window scrollbars. Repeat in English and Chinese, including failed/resumable tasks. Format tags should match the compact card badges.
- **Slider:** Verify five discrete positions, Medium by default unless a prior preference exists, keyboard arrows/Home/End, and restoring the saved value after reopening.

If a problem occurs, record the scenario, displayed message, ZIP contents, and request counters. Do not mark this checklist passed solely from unit tests or HTTP fixture self-checks.

Stop the local fixture server with Ctrl+C after acceptance. No scheduled monitoring is required.

## Inline task information acceptance (2026-10-25)

- Chrome reported Reloaded; overview retained 19 historical tasks and 0 active. Exactly one global folder button is present above the table, with no task-details buttons. Clicking it opened Finder Downloads.
- Actual rows show ZIP filenames, full source URLs and failure causes, including historical HTTP 503 and timeout errors. Long failure lists have their own bounded scrolling area. Bright amber indicators and pale warning badges were visually confirmed.
- Screenshot evidence was retained locally. No new image transfer was started for this visual check; active stage transitions and narrow-screen real-browser checks remain pending.
