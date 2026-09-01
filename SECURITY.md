# Security Policy

## Supported versions

当前仅维护最新的 Alpha 版本。早期版本不会继续接收安全更新。

## Reporting a vulnerability

请优先使用 GitHub 仓库的 **Security → Report a vulnerability** 私密报告入口。不要在公开 Issue 中提交以下内容：

- QQ Cookie、二维码或登录会话信息；
- API Key；
- 完整 QQ 号、私人动态、评论者或点赞者信息；
- 包含上述数据的归档、截图或诊断文件。

报告中请提供受影响版本、复现步骤、预期行为和实际影响。维护者确认前，请避免公开可直接利用的细节。

## Security model

- QQ 登录会话保存在 Electron 的临时独立分区中，只供当次采集使用；完成、失败或取消后清除，不进入 React 渲染层或本地归档。
- API Key 通过 Electron `safeStorage` 加密后保存在当前系统用户目录。
- 归档正文与媒体默认是未额外加密的本地文件，安全性依赖操作系统账户和磁盘保护。
- AI 功能会将相关档案文字发送到用户自行配置的模型服务商。
- 主窗口使用上下文隔离、沙箱、严格内部 URL 校验和默认拒绝权限策略；新窗口与外部导航只允许无凭据的 HTTPS 地址。
- 图片下载只接受 QQ 空间媒体白名单及安全位图类型，并在重定向后复验域名、在读取前后限制单文件大小。
- 当前 Alpha 没有自动安装更新；GitHub 版本检查只返回发布元数据，用户必须手动下载并核对 Release 中的 SHA-256。
