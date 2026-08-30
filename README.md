# 空间备份（QZone Journal）

一款本地优先的 QQ 空间个人动态备份桌面应用。它通过 QQ 官方登录页面建立本机会话，将可读取的个人空间内容整理为版本化本地档案，并可接入用户自己的 OpenAI 兼容模型生成回顾。

> [!WARNING]
> 当前为 `v0.1.1-alpha` 早期测试版。QQ 空间没有面向本项目的稳定公开导出 API，采集能力可能因 QQ 页面或接口变化而失效。首次使用前请阅读下方“当前边界”，不要把它作为唯一备份。

## 已实现

- Windows 桌面应用、安装版与免安装版。
- QQ 官方页面扫码登录，多个 QQ 账号使用彼此独立的持久会话。
- 独立 Utility Process 分页采集本人说说，保存正文、时间、配图、页面内嵌评论和可见点赞者。
- 配图下载、媒体去重、稳定条目 ID、每页恢复点和增量覆盖写入。
- 版本化本地目录、原子 JSON 写入、媒体索引与脱敏诊断信息。
- 档案搜索、分类、详情、QQ 风格图片网格和全屏图片查看器。
- 多个 OpenAI 兼容模型服务、模型自动检测、连接测试、AI 回顾与限定档案范围的追问。
- API Key 使用 Electron `safeStorage` 加密；Cookie 不进入 React 页面或归档文件。

## 当前边界

- 相册专项分页、视频、独立日志接口以及 Word、HTML、PDF 导出尚未实现。
- “相册与视频”在当前 Alpha 中只能覆盖说说里已经出现的配图，不能视为完整相册备份。
- 评论和点赞详情取决于 QQ 页面当时实际展开的内容，人员列表可能少于 QQ 显示的总数。
- 本地档案是普通 JSON 和媒体文件，不进行额外加密。请将备份目录放在可信磁盘和受保护的系统账户中。
- AI 功能会把相关档案文字和互动摘要发送到用户配置的模型服务，并可能产生费用。
- 当前没有自动更新器；请以 GitHub Releases 页面发布的版本为准。

## 安装

从 [Releases](https://github.com/Socialist-Sister/qzone-journal/releases) 下载：

- `QZoneJournal-0.1.1-alpha-x64.exe`：Windows 安装版。
- `QZoneJournal-0.1.1-alpha-x64-portable.zip`：解压后直接运行的免安装版。

当前 Alpha 安装包尚未进行商业代码签名，Windows 可能显示 SmartScreen 提示。请只从本仓库 Release 下载并核对 SHA-256。

## 版本规则

版本号采用 `v主版本.功能版本.修复版本[-alpha]`：第二位表示功能性更新，第三位表示 Bug 修复等小更新；带 `-alpha` 的版本不保证正常使用，不带 `-alpha` 的版本基本保证承诺范围内的核心流程可以正常完成。完整约定见 [VERSIONING.md](VERSIONING.md)。

## 本地开发

需要 Node.js 20+ 和 pnpm 9：

```bash
pnpm install --frozen-lockfile
pnpm dev:desktop
```

浏览器界面调试可运行 `pnpm dev`。浏览器模式不会连接真实 QQ 账号。

## 构建与测试

```bash
pnpm run build
pnpm run test:archive
pnpm run test:collector
pnpm run test:desktop
pnpm run test:ai-compat
pnpm run test:sites
pnpm run desktop:dist
```

桌面壳采用隔离的 preload 桥接层：渲染页面不能直接访问 Node.js、Cookie 或任意文件系统。真实采集器位于独立进程，只接收主进程校验后的任务参数。归档和采集边界分别见 [`desktop/archive/README.md`](desktop/archive/README.md) 与 [`desktop/collector/README.md`](desktop/collector/README.md)。

## 隐私与安全

- 项目不会要求或保存 QQ 密码；登录发生在 QQ 官方页面。
- QQ Cookie 仅保存在 Electron 的独立会话分区，不发送到渲染界面，也不写入归档。
- 备份位置由桌面主进程和系统目录选择器管理，渲染界面不能传入任意写入路径。
- 请不要在公开 Issue 中粘贴 Cookie、API Key、QQ 号、私人动态或归档诊断文件。安全问题请参阅 [`SECURITY.md`](SECURITY.md)。

## 免责声明

本项目与腾讯及 QQ 空间没有隶属、授权或合作关系，仅用于备份用户本人有权访问的个人内容。使用者应遵守所在地法律、QQ 服务条款及相关内容权利，不得用于绕过访问控制或采集他人空间。

## 许可证

代码以 [MIT License](LICENSE) 发布。项目内图片素材与第三方依赖可能适用各自许可；发布或再分发时请保留对应说明。
