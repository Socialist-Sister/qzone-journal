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

- QQ 登录会话保存在 Electron 的独立持久分区中，不进入 React 渲染层或本地归档。
- API Key 通过 Electron `safeStorage` 加密后保存在当前系统用户目录。
- 归档正文与媒体默认是未额外加密的本地文件，安全性依赖操作系统账户和磁盘保护。
- AI 功能会将相关档案文字发送到用户自行配置的模型服务商。
