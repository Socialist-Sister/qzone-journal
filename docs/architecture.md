# 应用结构（v0.7.4-alpha）

这轮重构保留 Electron + React、Utility Process 采集、逐条 JSON 档案和增量索引。目的是让功能修改落到明确模块，避免页面、权限和数据转换继续集中在两个入口。没有引入数据库、状态管理框架或新依赖。

## 前端

| 目录 / 文件 | 职责 |
| --- | --- |
| `src/App.jsx` | 页面组装；AI 回顾仍保持挂载，切换导航不丢失结果 |
| `src/hooks/useAppController.js` | 活动账号、当前档案、导航及原生窗口操作 |
| `src/features/backup/` | 备份对话框、演示导入；`useBackupFlow` 管理采集事件订阅、取消与重新登录 |
| `src/features/archive/` | 档案详情、虚拟时间线、导出、混合媒体查看器；`useArchiveEntries` 管理服务端分页、筛选和请求代次 |
| `src/features/review/` | AI 回顾、证据回答和模型选择 |
| `src/features/settings/` | 设置界面 |
| `src/components/` | 工具栏、空状态和加载指示 |
| `src/domain/media.js` | 首选有序 `media`；仅旧载荷缺少该数组时回退至 `images` / `videos` |
| `src/domain/demoArchive.js` | 离线演示档案的本地状态 |
| `src/lib/presentation.js` | 错误、文件大小和安全外链等呈现工具 |

媒体网格、查看器和时间线使用同一媒体入口。主进程为兼容旧消费者继续提供 `images` / `videos`，它们是有序媒体的派生值，不承担排序职责。

## Electron 主进程

| 目录 / 文件 | 职责 |
| --- | --- |
| `desktop/main.cjs` | 组装服务、注册 IPC、应用启动及退出 |
| `desktop/window.cjs` | 主窗口、可信来源、权限、导航与外链策略 |
| `desktop/ipc/` | 按应用、档案、AI 分组的显式 IPC 注册及输入约束 |
| `desktop/services/archives.cjs` | 获准目录、账号索引、分页读取、修复、回收站删除 |
| `desktop/services/collector.cjs` | 单一采集任务所有权、启动锁、Utility Process、会话清理及终止索引 |
| `desktop/services/exports.cjs` | 导出任务锁、文件选择、进度、原子输出与 PDF 窗口 |
| `desktop/services/preferences.cjs` | 原子偏好存储、当前目录与历史获准目录 |
| `desktop/services/diagnostics.cjs` | 白名单脱敏诊断 |
| `desktop/ai/` | 系统加密配置、兼容请求重试和档案提示上下文 |
| `desktop/contracts/collector-events.cjs` | 采集事件类型、公开计数及结果白名单 |
| `desktop/archive/renderer-entry.cjs` | 唯一档案条目到界面载荷转换入口；本地媒体 URL、混排、提及和互动计数 |

依赖方向是 IPC → 服务 → 档案/采集/AI 实现。服务不反向导入 IPC 或主入口。采集 worker 的路径不会直接进入事件；只有采集服务可用自身选择的档案根目录填充结果。账号切换、添加、删除和修复会同时检查“正在启动”和“已经运行”的采集状态。

## 兼容和验证

- 档案目录 schema、条目索引、解析器版本（10）、预加载接口和偏好键保持兼容；无需为这次重构重新采集。
- 界面布局及 CSS 保持不变；不调整图片/视频原序、全屏权限和临时登录会话约束。
- `pnpm run test:contracts` 从存储分页、条目转换一直检查到前端媒体入口，并通过真实 Electron 主入口验证目录、账号档案、分页及搜索 IPC。
- `pnpm run test:all` 覆盖上述契约及原有档案、安全、采集、会话、桌面、导出、压力、AI 和 Sites 测试。
- 桌面视频夹具采用显式帧请求，并等待视频元素就绪，避免隐藏窗口调度造成的偶发失败；仍实际验证视频播放和原生全屏。
- 重构前源码快照位于 `artifacts/review-0.7.4/baseline/source-before-refactor.zip`；日志和截图在同级目录。

## 后续按证据推进

大档案导出任务进一步移出主进程、索引存储后端更换、完整 TypeScript 迁移均不属于本次改动。先用现有压力测试和真实数据定位瓶颈，再独立实施和验证，避免把结构拆分与数据迁移混在一起。
