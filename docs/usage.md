# Using Image Extractor

Detailed selection, batch processing, download and recovery behavior. For installation and a quick start, see the [README](../README.md).

## Use

1. Open a page containing images. Complete any website verification yourself and load the desired page content.
2. Open Image Extractor. It automatically analyzes a new page and restores matching results when available. Use **Extract images** to refresh results, or choose **Scroll and extract** from the arrow beside it to load more page content first.
3. Choose page images (default) or enable **Match original images**, then use format and search filters. New extraction results start with nothing selected. Click individual images or use **Select all**. Switching mode does not add selections; previous manual choices are retained, and downloads, copying and TXT export use only the current mode. Reopening the same results restores your manual choices; re-extracting starts a new, unselected result set. Search and format filters preserve hidden selections within that mode. **Select all** selects visible results; **Deselect all** clears every selection, including hidden ones.
4. Choose a download policy, then select **Download selected**. Chrome requests download and image-host access permissions when needed.
5. Open **Download task** in the sidebar to view all page downloads in one place. You may close the popup; keep the download manager open until its tasks finish.
6. Use **Copy selected URLs** in the sidebar, or **Export TXT** under **More**. Copying shows confirmation on the button. Single-image actions copy a URL or save that image in a ZIP.
7. Open **Batch URLs / Import HTML** under **More** for batch processing. Open each webpage and choose images through the extension, or open an imported HTML result workspace and choose images there, before starting downloads. Optional bounded scrolling loads more page content and then restores the scroll position.
8. Click the language button at the bottom of the sidebar to switch between Chinese and English.

**Extraction scope** controls icons, CSS backgrounds, and embedded images/SVG and takes effect on the next extraction. Disabling all additional sources still extracts ordinary page images. Choose one of the five **Download speed** presets to save its policy. Settings synchronize across task pages.

## Download manager

All webpages share one task overview. Each task has its own selection snapshot, progress, cancellation, failed-only retry, and cache recovery. Closing this page interrupts the tasks it is running; completed cached files can be reused when recovery is available.

- **Read the results in the row:** ZIP filename, source webpage URL (or the local HTML label when no original page URL was provided), successful/failed image counts, and file size appear together. Hover over truncated filenames and source URLs to read them in full. Choose **Failure details** to open a scrollable dialog containing failed filenames, causes and complete image URLs.
- **Distinguish processing from saving:** Purple means successful images, amber means failed images, and gray means pending images. A fully processed bar can include failures. Packing and saving remain indeterminate until Chrome confirms the ZIP save.
- **Recover only what is missing:** Retry failed images without fetching successful ones again, or resume an interrupted task from valid local cache. Each action affects only its own task.
- **Find a task:** Search its title, filename or source URL and combine the search with a status filter. Filtering does not stop active transfers. Creation time appears in each row.
- **Clean up records:** Delete a finished record or clear all completed records. Downloaded files are kept; active tasks cannot be deleted, and bulk cleanup keeps failed, partially failed and cancelled tasks.
- **Open the downloads folder:** The single button above the table opens Chrome's default downloads folder. It applies to all tasks.

Saved ZIPs with partial failures have a warning status; unsaved failures are red, and cancellation is neutral. Status labels and numeric counts accompany the colors. On narrow screens the same task rows wrap without restarting downloads.

## Original URL matching

Some supported external image hosts require an optional detail-page lookup when original matching is enabled. Grant site access if prompted; completed lookups are saved without selecting images. See [forum host support](hosted-images.md) for supported formats, validation limits and references.

Matching uses site-specific URL rules; it does not upscale images or perform reverse image search. For example:

```text
https://image.imx.to/u/t/<path>/<name>.jpg
https://t01.imx.to/t/<path>/<name>.jpg
                         ↓
https://i02.imx.to/i/<path>/<name>.jpg
```

“Original” means an address matched a supported rule, not that its dimensions or availability have been verified. Extraction does not fetch converted originals. Unmatched source URLs remain available with original matching turned off; they are not classified by resolution. URL deduplication is not image-content deduplication.

Duitang blog images retain their `dtstatic.com` CDN hostname. Matching removes the `x-image-process` preview parameter or a legacy `.thumb.W_H` suffix while preserving other query parameters. Avatars are excluded from this rule.

Website changes, permissions, redirects, and verification pages may prevent conversion or downloading. Support for an image host means supported URL patterns, not every image on that host.

## Download policies

All tasks share a **hard limit of 30 in-flight image transfers**. Each source has its own policy limit and start interval; the same source across several tabs shares those limits.

| Policy | Per-source concurrency | Minimum start interval per source | Minimum global start interval |
| --- | ---: | ---: | ---: |
| Low | 5 | 2 s | 250 ms |
| Medium (default) | 10 | 500 ms | 150 ms |
| High | 20 | 100 ms | 100 ms |
| Extra High | 25 | 75 ms | 75 ms |
| Max | 30 | 50 ms | 50 ms |

Known shards of IMX, Imgbox, Vipr, Pixhost, ImageBam, Imagevenue, TurboImageHost, Acidimg, ImageTwist, Imgspice, and Postimages/Pixxxels each share their provider's budget, including declared output domains such as imagehaha.com and turboimg.net. Other hosts are separated by URL origin. A single task can use available capacity within these limits; capacity is not multiplied by opening more tabs, and equal sharing is not guaranteed.

HTTP 429 / 503 responses trigger shared cooldown, honor `Retry-After`, and reduce per-source concurrency during recovery. These controls limit request pressure, not bytes per second, and cannot guarantee that a website will not throttle requests. Higher presets have not all been validated against real image hosts. See [download policy details and test scope](download-policy.md).

## Output and recovery

- Archives use the webpage title, with invalid filename characters replaced. Image names use a sequence prefix such as `001_photo.jpeg`.
- New tasks save the active mode as a single image set. Retries of older tasks retain their original folder paths. Filename extensions are determined from actual image signatures; image bytes are preserved.
- Partial downloads include a failure report. An all-failed task does not save an empty ZIP.
- Failed-only retries produce a separate supplementary ZIP and preserve numbering and paths, allowing its contents to be merged with the original archive.
- Recovery verifies completed cached files before reusing them. It is file-based recovery, not HTTP Range byte-level resume. Cache availability depends on browser storage and a 24-hour retention window.
- Limits: **2,000 images per ZIP**, **128 MB per image**, **4 GB total image data**. HTML import accepts up to **20 files**, **16 MB each**. Storage quota failures are reported explicitly.

Downloads and ZIP creation stream through browser-local temporary storage instead of buffering the entire collection in memory. Waiting for response headers and response-body stalls have separate timeouts; a slow transfer making progress has no fixed total-duration timeout.
