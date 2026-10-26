<p align="center">
  <img src="assets/logo-source.svg" width="96" alt="Image Extractor icon">
</p>

<h1 align="center">Image Extractor</h1>

<p align="center">A Chrome extension to extract webpage images, find supported originals and download your selection.</p>

<p align="center"><strong>English</strong> · <a href="README.zh-CN.md">简体中文</a></p>

<p align="center">
  <a href="https://github.com/zenvor/image-extractor-extension/releases/latest">Download</a> ·
  <a href="docs/usage.md">User guide</a> ·
  <a href="https://github.com/zenvor/image-extractor-extension/issues">Report an issue</a>
</p>

![Image preview, filters and manual selection in Chrome](docs/store-assets/screenshot-en.jpg)

Interface preview with NASA images. [Screenshot details](docs/screenshots/README.md).

## Features

- **Browse before downloading.** Preview page images in a grid or list, search and filter by format, then choose what to save.
- **Find supported originals.** Resolve thumbnail addresses and image-host detail links, including images linked from ViperGirls posts and images on Duitang.
- **Work across sources.** Extract from the current page, a batch of webpage URLs, or saved HTML files. Optional sources include CSS backgrounds, icons and embedded images.
- **Keep downloads organized.** Save numbered images in ZIP archives and manage downloads from several pages together. Retry failed images or resume interrupted tasks when cached files are available.
- **Use the links elsewhere.** Copy selected image URLs or export them as a TXT list.

Free and open source. No account required. English and Simplified Chinese interfaces.

## Installation

Requires **Chrome 120 or newer**.

1. Open the **[latest release](https://github.com/zenvor/image-extractor-extension/releases/latest)** and download the `image-extractor-*-chrome.zip` package under **Assets**. The **Source code** archives are for developers.
2. Extract the ZIP to a folder you will keep on your computer.
3. Open `chrome://extensions`, enable **Developer mode**, and select **Load unpacked**.
4. Choose the extracted folder containing `manifest.json`, then open a webpage and click the extension icon.

The release includes a SHA-256 checksum alongside the ZIP. Finish active downloads before updating or reloading an installed copy.

<details>
<summary>Build from source</summary>

Requires Git and Node.js 22.12+ or a newer supported LTS release.

```sh
git clone https://github.com/zenvor/image-extractor-extension.git
cd image-extractor-extension
npm ci
npm run build
```

Load `.output/chrome-mv3` through **Load unpacked**. For development, use `npm install`; see the [development guide](docs/development.md).

</details>

## Getting started

1. Open an image page and load the content you want to save.
2. Open Image Extractor. Filter the results and select images individually or with **Select all**. Results start unselected.
3. Enable **Match original images** for supported sites; grant image-host access if prompted.
4. Choose **Download selected**, then follow progress in **Download task**. Keep the download manager open until tasks finish.

For batch URLs, HTML import, selection rules and recovery, see the [user guide](docs/usage.md).

## Supported originals

- **Forum pages:** ViperGirls (`vipergirls.to`) and accessible mirrors, including `viperproxy.org`.
- **External image hosts:** IMX, Imgbox, Vipr, Pixhost, ImageBam, Imagevenue, TurboImageHost, Acidimg, ImageTwist, Imgspice, and Postimages / Pixxxels.
- **Other URL rules:** Duitang and additional supported thumbnail formats; see the [original-matching guide](docs/usage.md#original-url-matching).

Forum support resolves linked images on the loaded page; it does not crawl every page of a thread. Supported URL formats, aliases and live-verification limits are documented in the [image-host guide](docs/hosted-images.md). Website changes, authentication and rate limits can affect results.

## Privacy

Processing and task storage stay on your device. Original-image lookup, previews and downloads contact the relevant source websites. There is no analytics or developer-operated extraction service. Website and download permissions are requested when needed. See the [privacy policy](docs/privacy-policy.md).

## Documentation and contributing

- [User guide](docs/usage.md) — selection, batch processing, ZIP downloads and recovery.
- [Download policies](docs/download-policy.md) — shared request limits and server cooldown.
- [Development](docs/development.md) — setup, checks and source layout.
- [Publishing releases](docs/releasing.md) — versioning and automated release assets.

Issues and pull requests are welcome. For a bug report, include a public example URL when possible, steps to reproduce, and your extension version. Remove private links and cookies before sharing logs.

## Acknowledgements

- [gallery-dl](https://github.com/mikf/gallery-dl) informed the image-host support through its public URL and page formats. See [reference and attribution details](docs/hosted-images.md#reference-and-attribution).
- Preview imagery comes from NASA's [Artemis II Lunar Flyby gallery](https://www.nasa.gov/gallery/lunar-flyby/). [Image credits and screenshot details](docs/store-assets/README.md).

## License

[MIT](LICENSE). Third-party components retain their own licenses; release packages include their notices.
