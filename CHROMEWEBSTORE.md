# Chrome Web Store Listing — Image Extractor

Last updated: 2026-10-30. Prepared source/GitHub release version: 1.2.0. Last recorded Store submission: 1.0.0, Pending review on 2026-10-25 with automatic publication enabled. GitHub publication does not submit a Store update.

## Store listing

Name: Image Extractor

Primary language: English. Additional listing language: Simplified Chinese.

Suggested category: Tools (confirm the current dashboard choices).

Short description (English):
Extract images from webpages or HTML, resolve original URLs from supported thumbnails, and save ZIPs with retries and recovery.

Short description (Simplified Chinese):
从网页或 HTML 提取图像，按已适配规则匹配缩略图的原图地址，支持 ZIP 下载、失败重试和缓存恢复。

Detailed description (English):

Extract images from webpages and local HTML files, select the images you want, and save them individually or as ZIP archives.

Collect images from the current page, batches of up to 20 webpage URLs, or local HTML files. Preview and filter the results, switch between grid and list views, copy image URLs, or export selected links.

Optional original matching converts thumbnail URLs using built-in rules for supported websites. Matching does not verify image resolution or guarantee that every generated URL is available. Unsupported websites still work with ordinary page-image extraction where accessible.

New results start with no images selected. ZIP downloads support failed-only retries, cancellation, and recovery using complete locally cached images. Website throttling, permissions, authentication, and available browser storage can affect results.

Includes English and Simplified Chinese interfaces. All features are free; no account or payment is required. Extraction and URL matching run locally. Image previews and downloads contact the source websites. Website access and download permissions are requested when needed.

Detailed description (Simplified Chinese):

从网页或本地 HTML 文件中提取图像，选择需要的图片，单独保存或打包为 ZIP。

支持当前网页、每批最多 20 个网页网址或本地 HTML 文件。提供预览、格式及文字筛选、网格与列表视图、复制图像网址和导出所选链接。

可选的原图匹配使用内置站点规则转换缩略图地址。命中规则不代表已验证实际分辨率或保证地址可下载。未适配的网页仍可使用普通页面图像提取，具体取决于页面可访问性。

新结果默认不选择图片。ZIP 下载支持仅重试失败项、取消及复用已完整缓存图片的任务恢复。网站限流、权限、登录状态和浏览器存储空间可能影响结果。

提供简体中文与英文界面。全部功能免费，无需账号或付款。图像提取与地址匹配在本地执行；预览和下载会访问源网站。网站访问和下载权限按需请求。

Single purpose:
Help users discover, select and save images from webpages or local HTML, including original URL matching for supported thumbnails.

## Permissions justification

| Permission | Type | Justification for reviewers |
| --- | --- | --- |
| activeTab | required | Access the current page only after the user invokes the extension to extract its images. |
| scripting | required | Run the bundled image collector in a user-selected webpage to read image URLs and page metadata. |
| storage | required | Store local preferences, per-page extraction state and download history needed for retries and recovery. No Chrome sync storage is used. |
| downloads | optional | Save user-requested images, ZIP archives and link exports, observe save completion, and open the downloads folder. |
| http://*/* and https://*/* | optional host access | Users can supply arbitrary webpage and image-host URLs. Access is requested as needed for their chosen sites to collect pages and fetch selected image files. A fixed hostname list cannot cover user-specified sources. These optional patterns do not automatically grant access to every site. |

Remote code: No. Executable code and matching logic are bundled. Remote pages and images are processed as content, not executed as extension code.

## Privacy and data use

No developer-operated collection endpoint, analytics, advertising, account or payment service is integrated.

The extension processes website content (image URLs, page title/URL and imported HTML) and user selections locally to provide its single purpose. Task records may contain source URLs, image URLs, filenames, errors and transfer results. Browser-local temporary storage holds downloaded image bytes for ZIP creation and recovery. Preferences and task records use local/session extension storage, not Chrome sync.

Previews and downloads contact user-selected source sites. Requests reveal normal network information, including IP address, and may include cookies according to browser and website policies. Batch webpage loading also contacts the requested website. Do not describe this as "no network requests" or "no data ever leaves the device".

Data is not sold, used for unrelated purposes, or used for creditworthiness. The final dashboard declarations must accurately distinguish local processing from collection/transmission and be reviewed against the current form before submission.

Privacy policy: https://gist.github.com/zenvor/054206a25dc00fe4cf1de693528d2635 (public hosting authorized by the user and verified without authentication). Source: docs/privacy-policy.md. Contact: luckxiaomi@gmail.com.

## Assets

| Asset | Current source | Submission readiness |
| --- | --- | --- |
| Icon | public/icons/128.png | Verify PNG dimensions and package presence |
| English screenshot | docs/screenshots/popup-en.jpg | Candidate SVG-logo preview; docs/store-assets/screenshot-en.jpg, 1280×800 |
| Chinese screenshot | docs/screenshots/popup-zh-CN.jpg | Candidate SVG-logo preview; docs/store-assets/screenshot-zh.jpg, 1280×800 |
| Small promotional tile | docs/store-assets/promo-440x280.svg | 440×280; generated PNG export available for Store upload |
| Primary promotional suite | docs/store-assets/light/README.md | Three final light posters; placement exports and 4K masters |
| Alternative promotional suite | docs/store-assets/real/README.md | Three retained NASA dark posters; placement exports and 4K masters |

Vector artwork update (2026-10-26): `assets/logo-source.svg` is the single logo source; the earlier PNG source was removed. Both READMEs and the extension interface display SVG directly; manifest PNGs and both promotional tile formats are generated from it. Both localized screenshots were recaptured with the new logo in an isolated candidate preview (see docs/screenshots/README.md for scope). The existing published ZIPs and submitted Store assets still contain the earlier artwork. Review and upload the refreshed assets with the next Store submission; this source change does not submit an update.

## Publisher and distribution

Publisher display name currently: luckxiaomi@gmail.com. Publisher ID: 82288fad-14d3-4394-9d40-822576edd142.

Public contact email: luckxiaomi@gmail.com (public use authorized by the user).

Homepage/support URL: https://github.com/zenvor/image-extractor. The repository is public; support requests can be opened in its Issues section.

Planned distribution: free, public. Confirm country/region settings in dashboard.

## Submission prerequisites

- [x] Developer account registered; user confirmed personal hobby activity, non-trader declaration saved, public contact email verified.
- [x] Public privacy policy hosted and checked without authentication; public contact authorized and verified.
- [x] Core final-build Chrome checks passed: normal native saving, failed-only retry, cancellation/recovery, two-page isolation, language preference. See docs/release-smoke.md for limits; five-page/narrow-screen manual scenarios remain unverified.
- [x] Real 1.0.0 English/Chinese screenshots and promotional artwork meet dashboard dimensions; see docs/store-assets/README.md.
- [x] Candidate typecheck, build, bundle and ZIP integrity checks pass. All 390 tests passed across 21 files: 388 in the sandbox, with the two loopback HTTP cases rerun successfully outside it after sandbox EPERM.
- [x] English/Chinese listing, assets, free/public distribution and privacy declarations completed in the dashboard.
- [x] Upload and submission verified: dashboard confirmed "Your extension was submitted for review" and status "Pending review". Automatic publication after approval enabled.

## Version history

Review fixes (2026-10-30): loading announcements initially follow the browser language, then the saved preference. Removing a completed retry record restores retry availability on its source task. The bilingual READMEs use the combined light showcase; Store screenshots remain separate.

Popup loading update (2026-10-30): show skeleton placeholders for the header, sidebar controls and image gallery while restoring the page and settings. Refresh localized popup screenshots before Store submission.

| Version | Date | Changes | Status |
| --- | --- | --- | --- |
| 1.2.1 | 2026-10-30 | Stack Download task and More on separate full-width rows in the popup sidebar; show image-type filters in a scrollable popover without shifting sidebar controls; simplify extraction-scope guidance; display each download task's creation date and time; add task search, status filters, individual record deletion and completed-record cleanup while keeping downloaded files; show skeleton placeholders while loading the task overview | Prepared for GitHub release; refreshed bilingual popup and download screenshots; Store submission remains separate |
| 1.2.0 | 2026-10-29 | Preserve extracted results during lazy loading and scroll extraction; show 21 images per page without replaying selection animations; constrain tall and failed previews; streamline extraction, clipboard, export and language controls; refine rounded surfaces, hover feedback and checkbox contrast; keep settings stable while saving; improve download summaries, progress and failure-detail dialogs | Prepared for GitHub release; no new permissions; refresh popup and download-page screenshots before Store submission |
| 1.1.0 | 2026-10-26 | Eleven image-host provider families for forum original lookup; optional detail access, cancellation and shared budgets | GitHub 1.1.0; not submitted to Chrome Web Store |
| 1.0.0 | 2026-10-25 | First stable release; free extraction, supported original matching and ZIP downloads | Pending review; auto-publish enabled |

## Local package validation

Package: `.output-staged/image-extractor-1.0.0-chrome.zip` (35 files, 333354 bytes). Manifest is at the ZIP root; version is 1.0.0 and manifest version is 3. ZIP CRC, icon sizes, localized description lengths and bundled third-party notices checked. Source LICENSE is included.

SHA-256: `dee6717dcd74aab2bcd81457cbe1f195e5f3419aca555fe094ec387b8957efcc`.

Developer Dashboard opened on 2026-10-25 but redirected to Google identity re-verification. No package uploaded and no account registration/payment performed.

2026-10-25 update: account registration completed by the user. Dashboard is accessible and requires the EEA trader/non-trader declaration before continuing. No item has been created or submitted. The installed 1.0.0 normal-download Chrome smoke passed; remaining manual checks and refreshed screenshots are still pending. Public contact email luckxiaomi@gmail.com has now been authorized by the user.

2026-10-25 update: non-trader declaration saved and public email verified. Candidate 1.0.0 uploaded successfully; store item ID: `ndeaeajbbikgkghamnlmckbiocdfmonp`. Store status remains Draft. English description and Tools category saved; store icon uploaded. No review submission yet.

Privacy dashboard: Website content selected; remote code No; all three Limited Use certifications selected. The extension stores chosen source-page URLs/titles as local task metadata, fully described in the policy. Web history classification was not selected after automatic review rejected treating task-source metadata as browsing history. Other sensitive-data categories remain unselected.

2026-10-25 store draft update: English and Simplified Chinese descriptions entered; Tools category; current 1.0.0 English global and Chinese localized screenshots uploaded; 128×128 icon and 440×280 promotional tile uploaded. Free/public/all-regions defaults verified. Homepage/support web URLs intentionally blank while the source repository is private; support email is present in both descriptions and the public policy.

## Confirmed submission

Submitted on 2026-10-25 (Asia/Taipei). Dashboard status: Pending review. Automatic publication after approval was checked in the submission dialog. This is not confirmation that the listing is live.

Dashboard: https://chrome.google.com/webstore/devconsole/82288fad-14d3-4394-9d40-822576edd142/ndeaeajbbikgkghamnlmckbiocdfmonp/edit/status

Store item ID: ndeaeajbbikgkghamnlmckbiocdfmonp. Submission screenshot retained locally under .output-staged/store-assets/submission-confirmed.jpg. No scheduled monitoring created.

## Version 1.1.0: forum image-detail lookup (2026-10-26)

Unreleased UI fix (2026-10-26): use the shared form component for the image-format filter and image search, with matching text size, horizontal padding, borders and shadows. Use small sidebar buttons, default form sizing and compact filter badges, and the large variant for the main download button. Preserve the established image-card control sizes. Keep the same single-row height with tags or the empty placeholder when toggling original matching. Format tags retain their appearance on hover, including when excluded. Refresh localized popup screenshots with the next Store submission.

Card appearance correction: preserve the original card badges, action sizes and circular selection control. Unselected controls appear on card hover or keyboard focus; selected controls stay visible, with scale and checkmark entrance animations matching the Web project's interaction.

Selection controls use an 18px circle and 12px checkmark. The circle's center sits 4px inside the thumbnail's top-left corner, matching crawler-web ImageCard's placement proportionally after reducing its 28px circle to 18px. Only the image content clips overflow, keeping the selection circle visible outside the thumbnail.

Selected cards use a 2px theme-colored border directly on the card, without a halo or offset gap. Selected and unselected cards share the same ordinary shadows, white padding and image geometry. Cards retain 16px spacing.

Grid and list cards use compact 10px padding in both selection states. The image's left edge is 12px from the card's outer edge including its 2px border.

Removed the image enlargement button and modal. Cards retain thumbnails, selection, URL copying and downloads; users can use the browser's image context menu or open copied URLs themselves. Sidebar format tags use rectangular shapes with 4px corner radii instead of pill shapes.

Sidebar wording now uses "Filter images by type", "Download speed" and "Extraction scope". Five single-selection segments replace the download-speed slider; compact labels and a concurrency-only summary avoid repeated preset names and wrapping. Download admission limits and saved preset keys are unchanged.

The format filter uses 8px padding and grows naturally as its tags wrap, without an internal scrollbar. Its empty state reserves the same 38px minimum height as a single tag row. Compact 20px tags use 11px text and 4px corners. The English high preset is written "xhigh". The sidebar no longer scrolls; its compact two-column actions keep copying, exporting and scroll extraction visible, with batch/HTML tools, download tasks and recovery actions in the More menu.

The image gallery hides its scrollbar while retaining mouse-wheel, trackpad and keyboard scrolling in grid and list views.

Excluding an image type no longer adds a Reset button beside the filter heading, keeping the sidebar heading height stable. Types can be re-enabled by clicking their tags again.

The popup uses temporary toast notifications for download starts and results instead of a permanent status, progress bar or Details link beside the Download heading. Progress updates do not create repeated notifications, and reopening the popup does not replay old task results. Detailed progress and recovery remain available under More → Download task. Other popup feedback uses the same dismissible notifications.

Single-image downloads from a card or a one-image selection save the image itself through Chrome Downloads, without creating a ZIP or opening an archive task page. Remote names and types are determined by Chrome and the server response; inline images receive a safe filename with their image extension. Only the downloads permission is requested for this direct path. Multi-image popup selections retain ZIP creation, retries and recovery.

The gallery displays at most 20 images per page. Every card on the current page is rendered immediately; scrolling only triggers native lazy loading of its thumbnail, without mounting or unmounting cards. Compact previous/next controls and a page fraction sit beside the image count in the fixed top toolbar, leaving no separate pagination footer. Selections survive page changes. Select all continues to select all matching images across pages. Up to three visited pages retain their image elements and load/error state; older pages are released. The gallery still loads page thumbnails rather than fetching converted originals for previews.

Global styles now use the shadcn/ui Neutral theme scaffold, including its radius scale and base border/outline colors. Custom global font-medium, shadow-xs/shadow-md, purple ring/accent-color, cursor and forced focus-outline overrides were removed. Generic Checkbox and Progress components use primary colors; approved purple image-card selection remains scoped to the card. Labels, form surfaces, empty states, tool/download Cards, Alerts and table headers retain component defaults, with business layout, responsive wrapping, compact button sizes and image-format badge styles preserved. Native focus and component focus indicators remain available. Remaining global body typography and blanket motion overrides are removed; reduced motion is scoped to custom card interactions. Image action colors use call-site utilities so ghost-button hover styles remain effective. Tools notices compose AlertDescription, and Tabs/Sonner wrappers follow the current official templates rather than local focus/shadow overrides.

Language selection now uses the official shadcn/ui New York Select implementation. Extraction scope uses the official DropdownMenu checkbox items for its three independent options, retaining saved preferences and keyboard navigation while removing the hidden Combobox input and custom highlight behavior. Selecting an option keeps the multi-select menu open. No new permissions are required.

Reopening the popup reuses the current tab’s session-cached extraction and explicit selections. Startup restores the active tab snapshot, saved view and preferences before mounting the workspace, so a completed cache does not first render as Extracting, zero images or empty type filters. Locale restoration runs in parallel. Real cache misses still trigger extraction automatically. Search, excluded image types, preview background, pagination and scroll position are now restored for the same extraction. Navigation, tab closure or a new extraction invalidates the associated view state. View snapshots are dispatched immediately to a background queue so closing the popup does not abandon a pending final position write; the queue validates each extraction job. The worker coalesces 100ms scroll bursts per tab and job, retaining the latest position without a popup-owned debounce timer or a lossy result-identity hash. Reopening flushes pending/in-flight view writes before restoring its snapshot, including within that window. Startup reconciliation preserves newer analysis/download events, and preference reads cannot overwrite a newer saved choice. Already decoded thumbnails use the browser image cache without showing a fresh loading skeleton. No additional permissions or external storage are used.

2026-10-27 theme refinement: shared controls use shadcn's Neutral palette, default medium font weight, radius scale, shadows and gray focus rings. Ordinary buttons retain sm sizing and the main download button retains lg sizing. The logo, selected image cards and their selection indicators keep purple accents (#5d5fef); image-format badges retain their category colors and compact rectangular shape. Card geometry, pagination, sidebar layout and download-state semantics are preserved.

Version 1.1.0 resolves individual external image-detail links on ViperGirls pages and accessible mirrors for eleven provider families; see docs/hosted-images.md. Optional access to the relevant image-host origins is requested when original matching is enabled. Detail-page HTML is read locally to locate image URLs; remote scripts are not executed. Original discovery therefore may contact a selected source image host before preview or download. There is no new developer endpoint, analytics, login service or manufactured verification cookie. Manifest permissions are unchanged.

The submitted 1.0.0 store artifact does not include this change. GitHub publication of 1.1.0 does not submit or approve a Chrome Web Store update. The public policy linked from the store must be synchronized before a 1.1.0 store submission.

1.1.0 candidate validation (2026-10-26): all 428 tests in 22 files, type checking, isolated build, production-bundle checks and 35-file ZIP integrity passed. Built manifest version: 1.1.0. Existing installed extension was not reloaded; provider-specific live verification limits are documented in docs/hosted-images.md.
