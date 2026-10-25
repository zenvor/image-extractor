# 爬虫特性对照与实现范围

当前扩展版本：0.6.8。表格同步日期：2026-10-25；爬虫对照基线审查日期：2026-10-23。
对照范围包括 crawler-runner 的 README、CLI 参数、采集、原图匹配、下载与账本，以及 crawler-web / crawler-api 的入口。扩展所需代码已包含在本仓库中，独立构建和测试无需这些项目。下文区分实现范围与实际验收，不把按钮或测试文件存在当作运行验收。

## 已覆盖或本轮补齐

| 爬虫能力与代码证据 | 扩展对应实现 | 状态/差异 |
|---|---|---|
| 当前页 DOM、标题、baseURI：runner/lib/extractionUseCase.js | lib/collect.ts | 已有；新增惰性 HTML 片段解析 |
| img、lazy、srcset：runner/lib/browser-scripts/imageExtractorClient.js | collect.ts、srcset.ts | 补 data-lazy-src/data-srcset；已有 picture/currentSrc |
| 独立直链、语义 meta | collect.ts、resolve.ts | 补全 SVG/BMP/TIFF/ICO 格式和图片 meta 白名单 |
| favicon、CSS 背景、SVG 引用 | collect.ts | 可选图标/背景；支持多重 url() 背景及 image-set 内 url()；扫描上限 5000 元素；内联 SVG 补入同页跨 SVG 引用依赖 |
| data:image、inline SVG | collect.ts、imageSource.ts、archive.ts | 可选；编码长度每项128KB、总计1MB；实际下载仍校验文件头；不接收任意blob地址 |
| 图床原图映射：runner/lib/originalImageResolver.js | 本地 originalImageResolver.js、imageAddressPlan.js | 内置移植规则；IMX image 别名指向 i02；chpic显式生成透明/白底两个版本 |
| 页面专用策略：runner/lib/imageModeProcessor.js | collect.ts、imageAddressPlan.js | 补精确域名限定的 span/fancybox/target链接以及tn_路径规则 |
| `_webp` 变体：runner/lib/imageExtractor.js | imageAddressPlan.js | 只改pathname，保留主机和签名参数 |
| 动态滚动：runner/lib/pageLoader.js | scrollPage.ts | 用户主动触发，最多十步，恢复位置；不是无限滚动爬取 |
| 原图/全部、去重与顺序 | selection.ts、imageAddressPlan.js | 默认页面图像；原图匹配改为可选开关，无命中时不回退；URL去重，不冒充内容哈希去重 |
| 透明背景检查：web/src/components/ImageGrid.vue | 深色图片背景菜单 | 仅图片容器变色，现有布局不变 |
| 搜索、格式、多选、网格/列表、预览 | popup、ImageList、ImagePreview | 已有；大量图片使用虚拟列表替代Web分页 |
| 多URL：runner/cli/inputs.js | tools.html | 明确输入、最多20页、逐页分析、可选滚动加载、按需授权；每页独立ZIP和任务；辅助页跟踪结果和汇总 |
| 本地HTML：runner/lib/imageExtractor.js | tools.html、collectPage(imported) | 主动选择最多20文件，单文件16MB；不执行脚本，仅读现有地址；支持无来源 URL 时 HTML 内的绝对 base；停止不再提交下一文件；报告无法解析的相对地址，支持补充基准地址后单文件重试、名称及修改时间排序 |
| ZIP、文件名：runner/lib/fileManager.js | archive.ts、outputNaming.js | 三位序号+原文件名、网页标题ZIP保留；chpic 响应头命名及透明/白底前缀；单图按钮仍沿用ZIP契约 |
| 重试、并发、失败清单、取消 | archive.ts | 五档滑块（低/中等/高/极高/超高），跨任务全局上限30、来源额度5/10/20/25/30及启动间隔，429/503冷却；单图额外重试一次，未复制CLI所有调优参数 |
| 仅重试失败项 | archiveState.ts、requestArchiveRetry.ts | 已有；保留原编号、补充ZIP、成功项不请求 |
| 中断恢复：runner/lib/downloadLedger.js | archive.ts、archiveState.ts | 新增24小时OPFS缓存恢复，核验已记录完成文件大小/格式；损坏缓存重下 |
| 复制链接、TXT | popup菜单 | 已有增强 |
| 资源预算 | collect、archive、tools | 明确来源数、内嵌长度、批次页数、单图/总ZIP预算；不无限分配内存 |
| 标签页隔离、权限可撤回、后台任务 | background、analysisState、archiveState | 同一任务总览管理所有网页的独立批次，保留来源隔离、单任务取消/重试/恢复及同一队列与权限检查 |

## 不直接搬入扩展的部分

- 服务端HTTP API、WebSocket服务、多用户鉴权、SQLite元数据库、终端日志、信号、文件锁、任意目录遍历、部署配置：属于服务端/CLI运行环境。扩展提供主动选文件和独立任务，不访问任意磁盘路径。
- Sharp完整格式转换/解码校验、TIFF输出、色彩配置与动画保真处理：浏览器Canvas只能替代部分PNG/JPEG/WebP转换，不等价于现有Sharp链路。本版继续保存原图字节，不偷偷有损重编码。
- 原图尺寸/大小排序及过滤：需要先请求原图获取真实元数据；按用户已确定要求，不恢复不准确尺寸，也不为展示预请求原图。
- 反爬、指纹、stealth、请求伪装和验证绕过：按用户先前要求不移植。遇到验证只提示用户在网页完成。
- 任意图片详情页导航、跨域iframe和封闭Shadow DOM：当前主框架采集范围不能保证读取，不声称全站全资源抓取。
- 服务器历史账本的跨目录复用、完整内容哈希及HTTP Range字节续传：本版仅同一任务、已记录完成文件的短期缓存复用；没有把两者混称为完整账本迁移。
- Web的“Multiple Sites”旧UI只是无行为tab，不作为已实现证据；本版批量入口有真实执行流程。
- 反选、只看已选、尺寸角标、哈希文件名等与用户已确定交互/命名冲突的内容不恢复。

## 复查修复范围

已补齐绝对 base、显式 unchanged 原图分类、同页 SVG 依赖、chpic 响应头命名、批量滚动、下载结果汇总、停止后续操作、最新选中数量同步；跨任务并发已在 0.6.1 补齐。外部 SVG 文件间的依赖并未递归下载；浏览器无法无授权读取的资源不声称支持。

## 验收边界

离线测试覆盖来源发现/开关、相对地址、内联预算与SVG清理、chpic双变体、规则域名边界、按网页发现顺序显示、HTML导入与页面隔离、真实ZIP内容、仅失败重试、JPEG缓存续传/损坏缓存重下/保存失败恢复、权限与生产序列化采集函数。

原站可能调整地址规则、访问权限或返回验证页；静态测试通过不等于所有图床实时可下载。批量页面会正常使用用户浏览器网络/会话，不绕过验证。HTML中依赖脚本生成或外部CSS的内容不会在离线导入中重现。

图片排序已按产品要求移除；侧栏附加采集默认全部开启，已保存的关闭设置仍保留。
