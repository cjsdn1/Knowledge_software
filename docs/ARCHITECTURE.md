# 架构与开发约定

## 数据流

1. 浏览器主动上传文件，服务端验证类型与大小，存入独立随机 ID 文件。
2. PDF 提取文字和页码；PPTX 仅读取 slide XML，不运行宏或嵌入对象。
3. 圈选在浏览器生成局部图片，不持续采集整个屏幕。
4. `/api/run` 将用户任务转换为工具 ID 序列，或接受已验证的显式序列。
5. 每步检查学习模式、网络开关、停用列表；只调用内置函数。
6. 中间输出传递给下一步；完整结果、来源页码、工具运行记录持久化。
7. 笔记和卡片归入课程。课堂事件以 session.startedAt 为共同起点；录音使用片段开始时间，转写后追加到课堂笔记。

## 实体

SQLite `records` 表按 `kind` 区分实体，主键为 UUID，正文为 JSON。settings 只有固定 ID `preferences`。当前采取单进程同步 SQLite 写入，避免客户端整份覆盖导致数据丢失；请求进入后台后每次写入为独立原子操作，整条工作流不做跨网络事务。

| 实体 | 主要字段 |
| --- | --- |
| courses | name、color |
| documents | courseId、fileId、name、type、pages[{number,text}] |
| files | name、mime、bytes |
| notes | courseId、title、content、source、sessionId、tags |
| cards | courseId、question、answer、source、dueAt、interval、reviews |
| sessions | courseId、title、startedAt、endedAt、noteId |
| events | sessionId、type、text、fileId、source、offsetMs、durationMs |
| workflows | name、description、steps、version |
| runs | courseId、request、steps[{id,status}]、status、output、error、noteId、cardIds |
| tombstones | entity、deletedAt（已删实体的墓碑，阻止离线设备把记录重新同步回来；超过 500 条裁剪最旧） |

流程执行途中失败时保留已完成结果；不撤销已保存卡片/笔记。服务重启时未结束的运行记录标记为中断，不自动再次调用付费服务。

## 接口

所有修改接口使用 JSON。错误返回 `{error}`，成功返回实体或结果。`GET /api/bootstrap` 返回个人空间状态，不包含环境密钥。没有跨域 CORS；跨站写入检查 Origin，私有接口可选使用访问口令。部署到公网前需要 TLS、正式身份体系、用户隔离、限流、配额和更严格的文件处理进程隔离。

| 路由 | 用途 |
| --- | --- |
| POST /api/login | 访问口令换取 HttpOnly、SameSite 会话 Cookie |
| GET /api/bootstrap | 加载全部课程、记录、设置和工具信息 |
| PATCH /api/settings | 模式、网络、自动保存、工具停用列表 |
| POST /api/courses | 创建课程 |
| POST /api/documents | `{courseId,name,data:base64}` 导入 |
| GET /api/files/:id | 读取原始材料或媒体 |
| POST /api/notes | 创建笔记 |
| PATCH /api/notes/:id | 更新内容 |
| POST /api/cards | 创建卡片 |
| POST /api/cards/:id/review | `{rating:again|good|easy}` 安排下次复习 |
| POST /api/sessions | 开始课堂 |
| POST /api/sessions/:id/events | 追加打点与附件 |
| POST /api/sessions/:id/end | 结束课堂并生成本地时间轴笔记，重复请求返回同一结果 |
| POST /api/media | 上传图像或录音 |
| POST /api/transcribe | `{eventId}` 转写已存录音 |
| POST /api/workflows | 保存声明式流程 |
| POST /api/run | `{courseId,steps?,request,input,image?,source?,history?}` 运行 |
| PATCH /api/cards/:id | 修改卡片问题与答案（不动复习进度） |
| DELETE /api/cards/:id | 删除卡片 |
| DELETE /api/notes/:id | 删除笔记，并把指向它的课堂/运行引用置空 |
| PATCH /api/workflows/:id | 修改流程名称、说明与步骤（版本号 +1） |
| DELETE /api/workflows/:id | 删除流程 |
| DELETE /api/documents/:id | `?refs=block\|detach\|cascade` 删除资料：拒绝 / 保留引用与文件 / 连同引用一起删 |
| DELETE /api/courses/:id | `?target=<courseId>` 迁移子项后删除、`?cascade=true` 级联删除；不允许删除最后一门课 |
| DELETE /api/runs/:id | 删除运行记录（运行中或仍在队列的任务返回 409） |
| DELETE /api/runs | `?courseId=&status=` 批量清理运行记录 |

## 可分享流程示例

```json
{
  "version": 1,
  "name": "课件双语整理",
  "description": "翻译、总结并归档",
  "steps": ["translate", "summarize", "save"]
}
```

最多八步，不能重复工具，`save` 只能是最后一步。导入文件不接受 JS、Shell、URL、密钥或运行时权限提升。新内置工具须同时登记工具元数据、权限、后端处理逻辑和行为测试。模型只返回文字/结构化卡片，不决定文件路径，也不能运行任意代码。

## Android 原生接入与续传

Android APK 包含现有界面。原生桥仅为包内固定域名的页面提供请求转发、私有附件收取和系统权限调用；设备令牌用 Android Keystore 加密，模型密钥始终只在电脑端。用户每次截图都经系统授权；悬浮窗、麦克风各自申请权限。电脑生成的一次性配对码有效期 5 分钟，配对后的设备可由电脑管理员撤销。

异网实验使用 Tailscale Serve 向私有 tailnet 发布受信任 HTTPS 地址，Node 工作站仅监听回环地址。反向代理的 TCP 来源也可能是 `127.0.0.1`，因此服务端绝不凭回环地址或 `X-Forwarded-*` 头授予管理员权限；管理员必须用独立访问口令登录，手机仍使用配对后生成的设备令牌。该入口不用 Tailscale Funnel，不开放公网访问。

手机 IndexedDB 队列按电脑 `serverId` 隔离。同步前先取 `/api/connection` 确认目标身份；文件以 256 KiB 分片、全文件 SHA-256 和稳定 `clientId` 上传。服务端记录已接收分片，重试时只传缺失部分；完成后重复请求返回同一文档。笔记、复习、课堂记录通过 `/api/sync` 的稳定操作 ID 在 SQLite 事务中写入回执。后台任务通过 `/api/jobs` 排队、查询进度、取消和重试；每个完成步骤保存检查点，重启后由用户继续，避免重复生成卡片或笔记。

新增接口：`GET /api/connection`、`POST /api/pairing/code`、`POST /api/pairing/claim`、`GET /api/devices`、`POST /api/devices/:id/revoke`、`POST /api/uploads`、`PUT /api/uploads/:id/chunks/:n`、`POST /api/uploads/:id/complete`、`GET /api/uploads/:id`、`POST /api/sync`、`POST /api/jobs`、`GET /api/jobs/:id`、`POST /api/jobs/:id/cancel`、`POST /api/jobs/:id/retry`。同步失败或冲突保留本机原件供重试或另存。电脑任务不依赖手机页面保持打开；手机前台恢复后轮询结果。

离线操作还包括 `note.delete`、`card.update`、`card.delete`：笔记用 `baseUpdatedAt`、卡片用 `baseReviews` 做乐观并发校验，版本不符返回 409 并保留本机版本；重复提交同一次删除返回同一结果（有墓碑时幂等返回 `alreadyDeleted`，不会 404）。离线新建、又在离线状态删除的记录，前端会直接撤销尚未上传的创建操作，而不是产生一次必然冲突的删除。删除与级联规则集中在 `lib/removal.mjs`，在线路由与离线同步共用同一份实现。

下一阶段需要将 SQLite 个人数据层迁移为按用户隔离的存储；让原生手机在 App 关闭后也可由系统后台作业上传待同步文件；完成 Android 真机验收与 iOS Share Extension。第三方插件需独立的受限进程/容器或 WASM 运行时、每次调用的能力令牌和可撤销权限，完成之前保持关闭任意代码导入。
