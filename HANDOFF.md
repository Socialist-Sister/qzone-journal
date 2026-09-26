# 空间备份项目交接文档

最后更新：2026-09-26
工作目录：`D:\ChatGPT files\qzone-journal`
远程仓库：`https://github.com/Socialist-Sister/qzone-journal`

## 公开版本编号调整（2026-09-26）

- 用户要求推送并发布 `v0.7.0alpha`，按项目格式统一为 **v0.7.0-alpha**。
- 本次发布包含已验证的最新代码（此前本地 0.7.4-alpha），不是回退到早期 0.7.0 实现。0.7.1～0.7.4 未曾发布，下面的版本号是开发过程历史记录。
- `package.json`、界面备用版本号、README 和 CHANGELOG 已统一。标签触发 GitHub Release 工作流，先运行 `test:all`，再构建安装版、免安装版和校验元数据。
- 发布说明见 `docs/releases/v0.7.0-alpha.md`。不包含完整相册/日志专项采集，也不宣称 Alpha 已达到 1.0 的人工兼容验收标准。

## 最新结构重构（2026-09-26，v0.7.4-alpha）

- 用户反馈“测试目前没有发现异常”，明确授权重构。该反馈不替代尚未逐项确认的旧版专项验收记录。
- 当前版本 **0.7.4-alpha**。前端 `App.jsx` 从 2504 行降为 43 行；页面、媒体查看器、共享组件、备份状态与分页状态按功能独立。Electron `main.cjs` 从 1346 行降为 24 行，窗口、IPC、档案、采集、导出、偏好、诊断和 AI 各有明确模块。
- [架构说明](docs/architecture.md) 是新代码定位入口。历史文档提及 `App.jsx` 或 `main.cjs` 中的具体函数时，应按该模块表寻找。
- 档案 schema、索引格式、解析器版本（10）、预加载接口及 CSS 保持兼容；本次无需重新采集现有档案，也没有加入运行时依赖。
- 媒体转换提取至 `desktop/archive/renderer-entry.cjs`；前端使用 `src/domain/media.js` 保持原序，时间线计数也使用同一序列。采集事件公开计数采用白名单，worker 路径不被信任。
- 采集启动阶段也纳入账号切换/添加/删除和档案修复的任务锁，避免异步启动窗口的竞态。
- `pnpm run test:all` 已全部通过：80 项 Node 用例，以及真实主入口 IPC、采集进程、临时会话、桌面完整交互、三格式导出和 AI 兼容性 Electron 回归。1 万条记录、5 万个媒体引用压力测试通过。
- 重构前的桌面基线发现隐藏窗口视频测试调度不稳定；修正为显式生成帧和等待元素就绪后，原版与重构版均通过。没有跳过实际播放或原生全屏断言。
- 源码快照：`artifacts/review-0.7.4/baseline/source-before-refactor.zip`；完整日志：`artifacts/review-0.7.4/full-regression.log`；截图：`artifacts/review-0.7.4/visual/`。
- 本地产物：`release/QZoneJournal-0.7.4-alpha-x64.exe`、`release/QZoneJournal-0.7.4-alpha-portable.zip`；包内新模块、版本与六项 SHA-256 已校验。打包后标准构建及 Sites 回归再次通过，托管要求的三个构建入口均保留。
- 用户随后授权推送 GitHub；本次提交包含此前尚未提交的修复及本轮重构，同步至 `main`。发行包仅在本地生成，尚未创建标签或 GitHub Release。下方“未提交/未推送”的旧条目描述其各轮结束时的历史状态。大档案导出移出主进程、数据库替换与全面 TypeScript 迁移仍是后续独立工作，不属于已完成范围。

## 最新缺陷修复（2026-09-05，v0.7.3-alpha）

- 修复 0.7.2 仅合并前端、采集仍把图片与视频分组拼接的遗漏。`emotionMedia` 在 `pic[]` 中按视频 ID/原片/封面别名找到对应视频，保留原格位；feeds3 按源码位置排序。
- 当前版本 **0.7.3-alpha**，解析器 **10**。旧档案已丢弃的顺序不能离线推断，用户需安装新版后再次扫码备份。既有事务式迁移会保留旧记录并支持失败回滚。
- 全屏根因是主窗口权限一律拒绝。现在只向可信应用主框架授予 `fullscreen`，QQ 登录会话和其它权限继续拒绝；Esc 优先退出全屏。
- 已通过 53 项档案测试、18 项安全测试、采集进程测试和桌面全流程；桌面测试使用同一权限策略，实际点击 Chromium 原生全屏按钮，检查原生窗口进入全屏及 Esc 返回，并验证从 QQ 原始字段到第 4、6、7 视频格位。
- 标准构建、4 项 Sites 测试与六项发行文件 SHA-256 校验也全部通过。
- 新本地产物：`release/QZoneJournal-0.7.3-alpha-x64.exe`、`release/QZoneJournal-0.7.3-alpha-portable.zip`。未提交、未推送、未发布。
- 截图见 `artifacts/review-0.7.3/`。还未以用户真实账号重采该条说说；不要把合成载荷回归描述为真实账号验收。
- 权限依据：[Electron session 权限文档](https://www.electronjs.org/docs/latest/api/session#sessetpermissionrequesthandlerhandler)，同时验证 requestingUrl、主框架及 WebContents 身份。

## 最新交互修正（2026-09-05，v0.7.2-alpha）

- 用户以手机 QQ 截图明确要求图片与视频混排；已取代 0.7.1 的独立视频卡片呈现。
- `src/App.jsx` 的 `MediaGrid` / `MediaViewer` 使用统一媒体序列，主进程返回按档案顺序生成的 `media`，兼容旧 `images` / `videos` 数据。
- 视频封面有播放图标和时长；查看器可以跨类型切换，支持自动播放、切换暂停和照片缩放复位。仅封面与播放错误在查看器中说明。
- 当前版本 **0.7.2-alpha**，本地包为 `release/QZoneJournal-0.7.2-alpha-x64.exe` 与 `release/QZoneJournal-0.7.2-alpha-portable.zip`；仍未提交或发布。
- 验证完成：桌面完整回归、50 项档案测试、17 项安全测试、4 项 Sites 测试、标准构建和六项发行文件 SHA-256 校验均通过。
- 回归截图位于 `artifacts/review-0.7.2/`；桌面测试动态生成离线 WebM，验证实际播放而非模拟播放器。真实 QQ MP4 编码兼容性仍沿用下方人工验证边界。

## 本轮接手更新（2026-09-05，优先于下面的历史记录）

- 当前工作区版本为 **0.7.1-alpha**，Git HEAD 仍为 `490c549`，所有修改均未提交、未推送、未发布。
- 已完成对 v0.7.0 工作区的审查与修复。完整范围、验证证据与尚待人工检查的项目见 [docs/review-0.7.1.md](docs/review-0.7.1.md)。
- 解析器版本为 **9**，条目索引版本为 **2**；保留事务式迁移，旧索引可重建。
- 视频/图片使用 `downloadMedia.consumeResponse → ArchiveStore.writeMediaStream` 流式落盘，不再在采集链路累积整个媒体 Buffer。`scripts/benchmark-media.cjs` 可复现 64 MiB 对照。
- 新增搜索竞态、评论命中、播放器重挂载/失败、视频增量补下载、导出时区、点赞部分数据、路径篡改与资源清理回归。
- 发行元数据已按当前版本筛选，可以保留旧版产物而不污染当前 SHA256SUMS。
- 最新本地产物为 `release/QZoneJournal-0.7.1-alpha-x64.exe` 和 `release/QZoneJournal-0.7.1-alpha-portable.zip`；校验结果和构建日志见审查报告。
- 真实 QQ MP4 采集/离线播放、Windows 干净环境、WPS 和代码签名仍需人工验证；不要把本轮自动化当成线上兼容性证明。

以下是接手时的 v0.7.0 历史快照，版本号、文件列表和测试数量以本轮审查报告为准。

## 1. 当前状态（历史快照）

- 当前分支：`main`。
- 当前 Git HEAD：`490c549`（`fix: make update checks proxy-compatible`）。
- 远程 `origin/main` 和最新公开标签均停在 `v0.6.2-alpha`。
- 本地 `package.json` 已改为 `0.7.0-alpha`，但这一批修改**尚未提交、尚未推送、尚未创建 Git 标签或 GitHub Release**。
- 当前工作区有一批有意保留的修改，主要是 QQ 原生上传视频支持和评论提及空格修复。不要执行 `git reset --hard`、`git checkout -- .` 或其它会丢弃修改的命令。
- 本地已生成测试产物：
  - `release/QZoneJournal-0.7.0-alpha-x64.exe`
  - `release/QZoneJournal-0.7.0-alpha-portable.zip`
- `release/SHA256SUMS.txt` 当前同时包含 `v0.6.2-alpha` 和 `v0.7.0-alpha` 文件。真正发布前应只保留目标版本资产并重新生成元数据，避免把旧文件一并上传。

如果 Git 因 Windows 账户不同报告 `dubious ownership`，可在单条命令中使用：

```powershell
git -c safe.directory='D:/ChatGPT files/qzone-journal' status
```

不要为了绕过该提示修改或重建 `.git`。

## 2. 产品目标与不可破坏的边界

这是一个本地优先的 QQ 空间个人档案桌面应用，当前核心目标是可靠备份用户**自己的说说**，而不是扫描好友动态。

所有后续工作先完整阅读根目录 [AGENTS.md](AGENTS.md)。其中的约束是当前产品与安全设计的来源。特别注意：

- 登录只能通过 QQ 官方页面；不请求、记录或转发 QQ 密码。
- 每个账号使用非持久 Electron Session，仅在一次采集期间共享给 Utility Process；完成、失败或取消后清除会话。
- 个人归档禁止访问 `scope=0` 好友动态流。主路径是本人“说说”分类 `emotion_cgi_msglist_v6`，只有首屏 `-10000` 限流时才退到本人 `scope=1` 时间线。
- Cookie 不进入 React、IPC 任务参数、归档或诊断文件；原始 QQ 响应正文也不落盘。
- 渲染进程不能提交任意归档路径。备份目录必须由主进程偏好与已授权根目录决定。
- 媒体必须校验 HTTPS、QQ 域名、重定向后的最终域名、MIME 和大小；不要为兼容视频放开任意网络地址。
- QQ 好友提及只保留昵称，不能在界面、导出或 AI 上下文暴露提及 token 中的 UIN。
- 点赞者只存清洗后的显示名，不保存点赞者 UIN。评论统一使用 `authorName`。
- API Key 只通过 Electron `safeStorage` 加密保存；删除 AI 服务时同步删除密钥。
- 诊断导出采用字段白名单，禁止包含 Cookie、完整 QQ 号、API Key、绝对路径、档案正文、人员详情和原始响应。
- UI 继续使用暖象牙纸张、炭黑文字、克制天蓝和活页纸边缘的现有视觉体系；PCL2 只是功能参考。

## 3. 代码结构

| 路径 | 职责 |
| --- | --- |
| `src/App.jsx` | React 界面与主要交互流程，包含首页、档案、AI 回顾、设置、导出对话框、图片查看器和视频卡片。 |
| `src/styles.css` | 桌面暖纸视觉、布局、滚动、缩放、无障碍和媒体组件样式。 |
| `desktop/main.cjs` | Electron 主进程、窗口、IPC、归档读取、AI 请求、导出、账号和采集任务协调。 |
| `desktop/preload.cjs` | 最小化的安全 IPC 桥。 |
| `desktop/qzone-session.cjs` | QQ 官方登录窗口、临时分区、会话验证、Cookie 清理和本人资料。 |
| `desktop/collector/qzone-adapter.cjs` | QQ 请求、分页 URL、会话探测、点赞补充和媒体下载安全边界。 |
| `desktop/collector/qzone-parser.cjs` | JSON/JSONP、有限 `\\xHH` 修复、说说/评论/点赞/图片/视频归一化。 |
| `desktop/collector/worker.cjs` | Electron Utility Process 中的分页采集、媒体并发下载、恢复点和增量写入。 |
| `desktop/archive/schema.cjs` | 归档选项与单条记录规范化。 |
| `desktop/archive/store.cjs` | 原子 JSON、媒体索引、增量条目索引、迁移事务、完整性检查与修复。 |
| `desktop/archive/exporter.cjs` | 匿名化与 HTML/PDF/DOCX 导出模型和渲染。 |
| `tests/` | 解析、安全、归档、性能、会话、采集进程、桌面 UI、AI、导出和 Sites 回归。 |
| `TODO.md` | 版本规划与正式版门槛。 |
| `docs/qq-compatibility-matrix.md` | 自动测试和真实 QQ 账号观察矩阵。 |

同一原型还需要兼容 Sites。不要删除或随意改写 `.openai/hosting.json`、`worker/index.js`、`scripts/prepare-sites-build.mjs`、`tests/sites-worker.test.mjs`。

## 4. 当前采集链路

1. 主进程打开 QQ 官方登录页并建立临时 Session。
2. 只有取得 QZone `p_skey` 且只读 feeds3 验证不再返回鉴权错误，才算登录完成。
3. 主进程把真实 Electron Session 绑定给 Utility Process，不序列化 Cookie。
4. Worker 优先分页请求本人说说分类，解析正文、图片、原生视频、评论、计数和安全外链。
5. 图片和视频最多三个并发任务；点赞详情另外按顺序慢速补充。
6. 每条记录即时原子写入，分页后更新恢复点与增量索引。
7. 采集完成、失败或取消后，主进程刷新本地档案并清理临时 QQ 会话。

归档以每条 JSON 为事实来源；索引可以重建。不要让 renderer 直接读取整个归档或一次性把大账号全部载入 React。

## 5. 尚未提交的 v0.7.0-alpha 改动

这批修改是当前最重要的交接内容。

### QQ 原生上传视频

- 区分 QQ 原生视频和 `b23.tv`、Bilibili 等转发外链；外部链接仍按链接卡片处理。
- `emotion_cgi_msglist_v6` 同时兼容：
  - 顶层 `video[]`；
  - 旧结构 `pic[].video_info`；
  - 转发结构下对应的视频字段。
- 视频记录保存 MP4 地址、封面地址、时长和尺寸；解析器版本由 7 升到 8。
- 若 QQ 同时把视频封面放入 `pic[]` 与 `video[]`，跨数组去重，封面不再冒充普通图片。
- 纯视频说说即使没有正文和图片也不会被过滤。
- Worker 分别下载视频和封面：视频失败时仍继续尝试保存封面。
- 下载继续限定 QQ 媒体域名；图片上限 80 MB，视频上限 256 MB；当前允许 `video/mp4`、`video/x-m4v` 和 `video/quicktime`。
- 档案详情中，本地视频使用原生 `<video controls>` 播放；只有封面时明确显示“仅保留视频封面”。
- 时间线分别显示图片和视频数量。
- HTML/PDF/DOCX 不嵌入原视频，只使用可用封面和视频数量说明，避免巨大文件或错误地把视频当图片。
- CSP 已增加只允许本地 `file:` 媒体播放的 `media-src`。

### 评论提及

- 当 QQ token 与正文直接相连时，归一化为 `@昵称 正文`。
- 已有空格不重复添加；标点前不强制插入空格。
- 同时修复采集时归一化和旧档案在 renderer 中的兼容显示。

### 修改文件

当前 `git status --short` 中应包括：

```text
CHANGELOG.md
README.md
desktop/archive/exporter.cjs
desktop/archive/schema.cjs
desktop/archive/store.cjs
desktop/collector/qzone-adapter.cjs
desktop/collector/qzone-parser.cjs
desktop/collector/worker.cjs
desktop/main.cjs
index.html
package.json
src/App.jsx
src/styles.css
tests/archive-store.test.cjs
tests/electron-smoke.cjs
tests/qzone-parser.test.cjs
tests/security.test.cjs
```

本交接文件 `HANDOFF.md` 也会成为新增文件。

## 6. 已完成的验证

最近一次验证结果：

- `pnpm run test:archive`：41 项通过。
- `pnpm run test:security`：13 项通过。
- `pnpm run test:collector`：通过。
- `pnpm run test:desktop`：通过，包含：
  - 纯视频封面卡片；
  - 评论 `@昵称 正文`；
  - 图片查看器边界；
  - 档案详情滚动；
  - 账号、备份、导出、AI 和设置主流程。
- `pnpm run build:web`：通过。
- `pnpm run desktop:dist`：成功生成 Windows 安装包。
- `pnpm run release:portable`：成功生成免安装包。
- `pnpm run release:metadata`：成功生成校验和、SBOM 与依赖许可信息。

接手后先运行：

```powershell
git -c safe.directory='D:/ChatGPT files/qzone-journal' diff --check
pnpm run test:archive
pnpm run test:security
pnpm run test:collector
pnpm run test:desktop
```

准备发布前应再执行完整回归：

```powershell
pnpm run test:all
```

## 7. 仍需真实账号验证的关键点

自动测试无法证明 QQ 当前线上响应一定与样例一致。`v0.7.0-alpha` 目前最大的未完成项是**真实 QQ 原生视频回归**。

至少验证以下四条说说：

1. 仅发布一个本地上传视频，无正文、无图片：档案中必须出现一条视频说说。
2. 一条正文同时包含普通图片和本地上传视频：普通图片只出现一次，视频封面不能混入图片九宫格。
3. 转发一个 `b23.tv` 或 Bilibili 视频：仍显示外部链接，不应伪装成本地 QQ 视频。
4. 评论内容为 QQ token 紧接正文，例如 `@{uin:...,nick:张三,...}回复内容`：界面应显示 `@张三 回复内容`，且归档中不保留被提及者 UIN。

还应检查：

- 视频可以离线播放，关闭网络后仍使用本地文件。
- 采集完成后 QQ 临时会话已清除。
- 视频文件、封面和记录均写入当前账号的归档根目录。
- 同一条说说重复备份不会重复爆增媒体或条目。
- 取消或登录失效后已有视频、封面和恢复点不会丢失。
- “检查与修复”能识别缺失的视频文件与视频封面，并在修复后等待下次备份重新下载。

如果线上字段仍不匹配，优先使用现有脱敏页诊断计数定位；不要把原始响应正文写入诊断。确实需要研究原始数据时，只在用户明确同意的本机临时调试流程中查看，完成后删除，且不要提交或上传。

## 8. 已知风险与后续优化

### P0：发布 v0.7.0-alpha 前

- 用真实 QQ 账号完成上述纯视频与图文视频回归。
- 检查 MP4 的实际 Content-Type、重定向域名和是否需要特殊 Referer；只能按真实证据扩大白名单。
- 确认解析器版本 8 的迁移：旧档案在下一次备份开始时迁移，失败时能恢复旧记录，成功后旧记录保留在归档内 diagnostics 迁移目录。
- 清理目标 Release 目录中的旧版本资产并重新运行 `release:metadata`，避免校验文件混入 `v0.6.2-alpha`。
- 运行 `pnpm run test:all`。

### P1：正式版前

- 当前视频响应仍会在 Utility Process 中累计到内存 Buffer 后再原子写入；虽然有 256 MB 上限，但更稳妥的实现是“边下载边写临时文件、校验完成后原子改名”。改造时不能让 worker 决定任意文件路径。
- 连续多轮真实大号/小号备份，确认无数据丢失、重复爆增、恢复失败或会话误判。
- Windows 10、Windows 11 干净系统验证安装版和免安装版；验证旧档案读取和升级回滚。
- WPS 人工验证 DOCX；继续验证 PDF 页面边界。
- 取得可信 Windows 代码签名证书之前，不启用静默自动更新。

### P2：后续功能

- 完整相册专项分页适配器。
- 独立日志适配器。
- 完整视频库/相册视频适配器。当前实现只覆盖“说说”接口返回的原生视频。

## 9. 数据结构提示

解析器版本 8 的视频媒体记录大致为：

```json
{
  "kind": "video",
  "sourceUrl": "https://允许的QQ媒体域名/...mp4",
  "posterSourceUrl": "https://允许的QQ媒体域名/...jpg",
  "durationMs": 12500,
  "width": 1920,
  "height": 1080,
  "localPath": "media/files/哈希.mp4",
  "posterLocalPath": "media/files/哈希.jpg",
  "contentType": "video/mp4",
  "posterContentType": "image/jpeg",
  "size": 123456,
  "posterSize": 12345
}
```

`sourceUrl` 和 `posterSourceUrl` 只允许归一化后的 QQ HTTPS 媒体地址；renderer 只能收到主进程验证后生成的本地 `file:` URL。不要把 Cookie、请求头或任意本地绝对路径加入记录。

## 10. 发布规则

用户确定的版本格式是 `vMAJOR.FEATURE.FIX[-alpha]`：

- 第二位：功能性更新；
- 第三位：Bug、兼容性和小改进；
- 带 `-alpha`：不保证正常使用；
- 不带 `-alpha`：基本保证承诺范围内的核心流程正常。

本次原生视频属于功能更新，因此本地版本使用 `v0.7.0-alpha`。未经用户要求，不要自行推送、创建标签或发布 GitHub Release。

获得发布授权后建议顺序：

1. 确认工作区只有目标版本修改。
2. 跑 `pnpm run test:all`。
3. 生成安装版、免安装版和发布元数据。
4. 核对安装包、ZIP、SHA-256、SBOM 和许可证文件。
5. 提交代码并推送 `main`。
6. 创建并推送准确标签 `v0.7.0-alpha`。
7. 创建 GitHub Release，只上传该版本资产。
8. 再检查应用内“检查更新”能发现新版本。

## 11. 接手后的推荐第一步

不要先重构。先做一次只读审计和真实视频验证：

1. 阅读 `AGENTS.md`、本文和 `git diff`。
2. 运行上述定向测试。
3. 用免安装版对一个纯视频和一个图文视频说说重新备份。
4. 检查档案 JSON、媒体目录和 UI 行为。
5. 只根据真实失败证据补兼容分支与回归测试。

这样可以避免在 QQ 接口尚未真实验证前继续扩大实现范围。
## 12. 接手复核记录（2026-09-05）

- 已阅读根目录 AGENTS.md、交接文档及当前未提交差异；HEAD 仍为 490c549，本地版本为 0.7.0-alpha。
- 实际工作区还包含 TODO.md 修改，这是交接第 5 节文件列表的遗漏。
- 首次复测发现 tests/security.test.cjs 的发行配置测试仍硬编码 0.6.2-alpha；已将断言同步为 0.7.0-alpha。
- 本次验证：test:archive 41/41、test:security 13/13、test:collector、test:desktop（含 build:web）以及 git diff --check 均通过。
- 本次未执行 test:all、真实 QQ 登录采集或发布；现有安装包和免安装包未重新生成。
- AGENTS.md 中较早的 scope=0 回退描述已被后续“禁止好友流、仅本人分类及 scope=1 回退”约束取代；当前解析回归已验证拒绝 scope=0。
- 下一步仍是第 7 节的真实原生视频回归。尚不能把样例和 UI 自动测试通过视为真实视频兼容性已验证。
