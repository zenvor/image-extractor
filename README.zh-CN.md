<p align="center">
  <img src="assets/logo-source.svg" width="96" alt="Image Extractor 图标">
</p>

<h1 align="center">Image Extractor</h1>

<p align="center">提取网页图片、匹配原图并批量下载的 Chrome 扩展。</p>

<p align="center"><a href="README.md">English</a> · <strong>简体中文</strong></p>

<p align="center">
  <a href="https://github.com/zenvor/image-extractor-extension/releases/latest">下载扩展</a> ·
  <a href="docs/usage.zh-CN.md">使用说明</a> ·
  <a href="https://github.com/zenvor/image-extractor-extension/issues">反馈问题</a>
</p>

![Image Extractor：图片浏览与下载管理](docs/store-assets/light/showcase-1600x864.png)

使用真实风景照片和真实扩展界面的亮色宣传套图。另保留 [NASA 深色版](docs/store-assets/real/README.md)。

<details>
<summary>查看独立功能海报与品牌横幅</summary>

![图片浏览与选择](docs/store-assets/light/browse-1280x800.png)

![下载任务搜索、筛选与记录清理](docs/store-assets/light/downloads-1280x800.png)

![Image Extractor 品牌横幅](docs/store-assets/light/banner-1400x560.png)

图片结果经过精选，下载记录为演示数据。[高清素材与来源说明](docs/store-assets/light/README.md)。

</details>

<details>
<summary>查看中英文原始界面截图与示例网页</summary>

![简体中文界面](docs/screenshots/popup-zh-CN.jpg)

![下载管理界面](docs/screenshots/downloads-zh-CN.jpg)

![WhatsApp 示例网页](docs/screenshots/whatsapp-source.jpg)

[截图来源与演示数据说明](docs/screenshots/README.md)。

</details>

## 功能

- **先预览，再下载：** 网格或列表浏览图片，按格式与文字筛选，选择需要保存的内容。
- **匹配原图：** 解析已支持的缩略图地址和图床详情链接，适用于 ViperGirls 帖子中的图片、堆糖作品图等场景。
- **处理多种来源：** 支持当前网页、批量网址和本地 HTML 文件，可选采集 CSS 背景、图标及内嵌图片。
- **统一管理下载：** 图片按顺序编号并打包为 ZIP，在同一任务页管理多个网页的下载；按标题、文件名或来源网址搜索任务，按状态筛选，清理已完成记录时保留下载文件；支持仅重试失败图片，以及在有效缓存可用时恢复中断任务。
- **导出图片链接：** 复制所选图片网址，或保存为 TXT 清单。

免费开源，无需账号。界面支持简体中文与英文。

## 安装

需要 **Chrome 120 或更新版本**。

1. 打开 **[最新发布页](https://github.com/zenvor/image-extractor-extension/releases/latest)**，在 **Assets** 中下载 `image-extractor-*-chrome.zip` 安装包。**Source code** 是供开发者使用的源码压缩包。
2. 解压到电脑上准备长期保留的文件夹。
3. 打开 `chrome://extensions`，开启「开发者模式」，点击「加载已解压的扩展程序」。
4. 选择解压后包含 `manifest.json` 的文件夹，打开网页并点击扩展图标。

发布页提供对应的 SHA-256 校验文件。更新或重载已安装的扩展前，请先等待正在进行的下载完成。

<details>
<summary>从源码构建</summary>

需要 Git 和 Node.js 22.12+，也可使用满足要求的更新 LTS 版本。

```sh
git clone https://github.com/zenvor/image-extractor-extension.git
cd image-extractor-extension
npm ci
npm run build
```

通过「加载已解压的扩展程序」选择 `.output/chrome-mv3`。日常开发使用 `npm install`，详见[开发说明](docs/development.md)。

</details>

## 开始使用

1. 打开图片网页，加载需要保存的内容。
2. 点击 Image Extractor 图标，筛选结果后逐张选择或点击「全选」。新结果默认不勾选。
3. 需要匹配原图时，开启「匹配原图模式」，按提示授予图床访问权限。
4. 点击「下载所选内容」，在「下载任务」中查看进度，下载完成前保持任务页打开。

批量网址、HTML 导入、选图规则和恢复操作见[使用说明](docs/usage.zh-CN.md)。

## 原图支持

- **论坛页面：** ViperGirls（`vipergirls.to`）及可访问的备用域名或镜像，包括 [`viper.to`](https://viper.to/) 和 `viperproxy.org`。
- **外链图床：** IMX、Imgbox、Vipr、Pixhost、ImageBam、Imagevenue、TurboImageHost、Acidimg、ImageTwist、Imgspice、Postimages / Pixxxels。
- **其他地址规则：** 堆糖及其他已适配的缩略图格式，详见[原图匹配说明](docs/usage.zh-CN.md#原图匹配说明)。

论坛支持针对当前已加载页面中的图片链接，不会自动遍历整个帖子。地址格式、域名别名及实测边界见[图床支持说明](docs/hosted-images.md)。网站改版、登录要求和限流可能影响结果。

## 隐私

处理和任务存储均在本机完成。原图解析、预览和下载会访问对应的源网站；没有统计分析或开发者运营的提取服务。网站访问和下载权限按需申请，详见[隐私政策](docs/privacy-policy.md)。

## 文档与贡献

- [使用说明](docs/usage.zh-CN.md)：选图、批量处理、ZIP 下载与恢复。
- [下载策略](docs/download-policy.md)：共享请求限制与网站冷却。
- [开发说明](docs/development.md)：环境准备、检查与源码结构。
- [发布说明](docs/releasing.md)：版本管理与自动构建附件。

欢迎提交 Issue 和 PR。反馈问题时，请提供可公开的示例网址、复现步骤及扩展版本；分享日志前请移除私人链接和 Cookie。

## 致谢

- 宣传照片来自 [ISO Republic](https://isorepublic.com/media-category/landscape/) 和 [NASA](https://www.nasa.gov/gallery/lunar-flyby/)，详见[摄影署名、许可与截图说明](docs/store-assets/README.md)。
- [gallery-dl](https://github.com/mikf/gallery-dl)：图床公开地址与页面格式的参考，详见[参考来源及实现说明](docs/hosted-images.md#reference-and-attribution)。
- 界面示例使用 [WhatsApp 官网](https://www.whatsapp.com/)的图像。WhatsApp 品牌和图像归各自权利人所有，不表示合作或背书；详见[截图与宣传素材说明](docs/store-assets/README.md)。

## 许可证

[MIT](LICENSE)。第三方组件保留各自许可，发布包附带相应声明。
