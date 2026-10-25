# Chrome Web Store Listing — Image Extractor

Last updated: 2026-10-26. Submitted version: 1.0.0. Status: submitted; Pending review; automatic publication enabled.

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
| English screenshot | docs/screenshots/popup-en.jpg | Current 1.0.0 screenshot prepared as docs/store-assets/screenshot-en.jpg, 1280×800 |
| Chinese screenshot | docs/screenshots/popup-zh-CN.jpg | Current 1.0.0 screenshot prepared as docs/store-assets/screenshot-zh.jpg, 1280×800 |
| Small promotional tile | docs/store-assets/promo-440x280.png | 440×280, existing icon and name |

## Publisher and distribution

Publisher display name currently: luckxiaomi@gmail.com. Publisher ID: 82288fad-14d3-4394-9d40-822576edd142.

Public contact email: luckxiaomi@gmail.com (public use authorized by the user).

Homepage/support URL: pending public destination. Repository is currently private; do not advertise it as accessible support.

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

| Version | Date | Changes | Status |
| --- | --- | --- | --- |
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

## Unreleased: forum image-detail lookup (2026-10-26)

The development implementation resolves individual external image-detail links on ViperGirls pages and accessible mirrors for eleven provider families; see docs/hosted-images.md. Optional access to the relevant image-host origins is requested when original matching is enabled. Detail-page HTML is read locally to locate image URLs; remote scripts are not executed. Original discovery therefore may contact a selected source image host before preview or download. There is no new developer endpoint, analytics, login service or manufactured verification cookie. Manifest permissions are unchanged.

The submitted and published 1.0.0 artifacts do not include this change. Update the store package and screenshots only after validation and a deliberate versioned release.
