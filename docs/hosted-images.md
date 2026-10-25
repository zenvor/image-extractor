# Forum image-host resolution

This document describes image-host resolution in **1.1.0**. The previously submitted Chrome Web Store package is 1.0.0 and does not contain this feature.

## Scope and evidence

The target is the intersection of image hosts named in ViperGirls' own pinned [VRipper thread](https://vipergirls.to/threads/4660537-VRipper-(Cross-platform-Gallery-Ripper)) and the image hosts supported by [gallery-dl](https://github.com/mikf/gallery-dl). Checked on 2026-10-26 against gallery-dl commit `175d21fd8f7e52963911c02916d0634461cddb24`.

The forum thread names 15 hosts. Twelve of those names map to eleven gallery-dl provider families: Postimages and Pixxxels share a provider. This is a documented compatibility target, not a claim to have measured every image host across the forum's complete history. The thread's list can include hosts used in older posts; it is not a current posting-permission policy.

| Provider | Recognized detail-page domains | Original-image lookup |
| --- | --- | --- |
| IMX | imx.to, img.yt | Existing thumbnail mappings; detail-page image link |
| Imgbox | imgbox.com | Existing thumbs2 mapping; image metadata |
| Vipr | vipr.im | Existing /th/ mapping; image element |
| Pixhost | pixhost.to, pixhost.org | Existing .to thumbnail mapping; image element |
| ImageBam | imagebam.com | Image detail page |
| Imagevenue | imagevenue.com | Image detail page |
| TurboImageHost | turboimagehost.com | Image detail page, including turboimg.net CDN |
| Acidimg | acidimg.cc | Ordinary image-page form response |
| ImageTwist | imagetwist.com, imagehaha.com | Existing limited mapping; image detail page |
| Imgspice | imgspice.com | Image detail page |
| Postimages / Pixxxels | postimg.cc, postimg.org, postimages.org, pixxxels.cc, pixxxels.org | Image-page download link |

Imagezilla, PimpAndHost and Pixroute appear in the forum's list but were not found in the referenced gallery-dl supported-sites list. They are outside this intersection. Other gallery-dl image hosts are not added merely because gallery-dl supports them.

## Forum and page coverage

- **ViperGirls (`vipergirls.to`) and its browser-accessible mirrors, such as the user-provided `viperproxy.org`:** read image elements and their enclosing links on the currently loaded page. You must open the page and complete login or website verification yourself.
- **Batch URLs and imported HTML:** use the same extraction and image-host rules. Imported HTML needs a usable original URL or base for relative links. Open the result workspace and enable original matching to resolve its recognized detail links.
- The lookup is based on the external image host and supported URL format, so it can work on another forum using those same links. That does not establish tested compatibility with every forum.
- This feature does not use the forum's `vr.php` API, auto-like posts, collect all pages of a thread, or crawl subforums. It does not enumerate images from an image-host gallery URL; it resolves individual images linked by page thumbnails.

## How it works

Ordinary extraction remains local. Existing deterministic thumbnail mappings need no new detail request. When you enable **Match original images**, unresolved recognized image-detail links require optional access to the relevant image-host origins. Denying permission preserves the existing extraction and URL-rule matches.

Detail pages share the existing cross-page download scheduler and provider budgets. They are also read sequentially within each popup, with a 500 ms pause between requests, a 15-second request deadline, and a 2 MiB response limit. No remote scripts are executed, no frames are loaded, and fetched markup is never inserted into the visible document. A detached template is used only to inspect provider-specific image metadata. Cookies follow browser policy; the extension does not manufacture login or verification cookies.

Only HTTP(S) targets with recognized hostnames and paths are accepted. Original-image URLs must stay within the provider's declared image/CDN domains. Redirect responses, website challenges, unsupported page formats, ambiguous images and failures remain unresolved; they are not reported as successfully matched originals. Users may need to open a canonical image page or complete a website check before retrying.

Each successful lookup is saved to its original extraction job without automatically selecting images. Closing the popup cancels unfinished requests; already saved successes remain available. To retry unresolved pages, turn original matching off and on. Re-extracting creates a new result set.

## Reference and attribution

Thanks to **[gallery-dl](https://github.com/mikf/gallery-dl)** and its contributors for documenting and implementing support for these services. The host coverage, public URL formats and page structures in its [image-host extractors](https://github.com/mikf/gallery-dl/blob/175d21fd8f7e52963911c02916d0634461cddb24/gallery_dl/extractor/imagehosts.py), [Imgbox extractor](https://github.com/mikf/gallery-dl/blob/175d21fd8f7e52963911c02916d0634461cddb24/gallery_dl/extractor/imgbox.py), [ImageBam extractor](https://github.com/mikf/gallery-dl/blob/175d21fd8f7e52963911c02916d0634461cddb24/gallery_dl/extractor/imagebam.py) and [ViperGirls extractor](https://github.com/mikf/gallery-dl/blob/175d21fd8f7e52963911c02916d0634461cddb24/gallery_dl/extractor/vipergirls.py) informed this browser-oriented implementation.

The referenced upstream files carry GPL-2.0 notices. Image Extractor implements its own TypeScript parsing and permission flow; it does not bundle gallery-dl, translate its Python source, or claim its upstream code is MIT-licensed. Test fixtures here are synthetic HTML describing site shapes, not copied upstream tests or third-party photo content. The existing project MIT license and unrelated third-party license notices remain in place.

## Validation boundaries

Provider-shaped synthetic tests exercise all eleven parser families and Pixxxels aliases. Integration tests cover permission denial, stale jobs, provider validation, partial success and cancellation. Those checks do not prove that every current live image page, historical thumbnail format or mirror works. Live site outcomes must be recorded separately before claiming end-to-end compatibility or publishing a new store package.

### Version 1.1.0 checks (2026-10-26)

- Chrome fixture page: all eleven synthetic provider cases plus the inert-HTML case passed (12/12). This was a separate local parser harness; the installed extension was not reloaded.
- Live HTML reads: saved responses from Vipr, Pixhost and ImageTwist produced provider-scoped original URLs. No photo bytes were downloaded as part of these checks.
- Other sample responses exposed normal IMX intermission forms and ImageBam/Imagevenue canonical redirects; the implementation handles the form and canonical request URL. This does not establish a successful complete lookup on those hosts.
- TurboImageHost returned HTTP 403, Imgspice timed out, a Postimages sample returned 404, and the Acidimg sample did not contain a usable original. Those services remain covered by synthetic parser tests, with live compatibility unverified.

These outcomes are sample-specific. They are not evidence that all current or historical posts can be downloaded, and do not establish Chrome Web Store approval of 1.1.0.
