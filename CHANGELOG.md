# Changelog

## [1.0.0] - 2026-11-15

首个可用版本（P2–P6）。

### 新增

- 项目骨架：TypeScript + Node 22（`node:sqlite`），配置/日志/错误码/加密（AES-256-GCM）。
- UpstreamClient：token 注入（GET query / POST body）、公共参数、重试、错误码映射（-2/1004/1114 等）。
- 统一 envelope `{ok,data,meta,error}`；CLI / REST / MCP / spec 单一能力注册表（43 项能力）。
- 登录模块：cloakbrowser 驱动、钉钉 SSO 二维码（ZXing 解码 + qrcode 重编码、终端渲染、base64）、
  状态机、钉钉组织/孚盟企业自动选择、token 加密落库、心跳保活、到期重登队列、调度器。
- 会话能力：`session.list/status/login/qr/cancel/logout/heartbeat`。
- 只读能力：`customer.list/get`、`open_sea.list`、`dedup.check/history`、`contact.list`、`followup.list`、
  `customs.query`（按公司，强制本地缓存）、`customs.dictionaries`、缓存统计/清理。
- 海关缓存：TTL（默认结果 24h/字典 7d）、上游更新日志失效、gzip、LRU（默认 20 万条/2GB）、权限域隔离。
- 请求池：账号级串行、QPS + 抖动、读路由/写指定账号。
- 写能力（本地优先）：`open_sea.claim`（强制先查后领）、`open_sea.release`、`customer.create/update/delete`、
  `followup.create`、`contact.create`；outbox + 同步 worker + 对账（冲突收敛上游）+ 事件。
- 规则引擎：容量（默认 500，按角色规则解析）、15 天保护期、3 天冷却、查重强制。
- 任务：`task.get/list/cancel`、批量查重任务化。
- 事件：`event.list`（sinceSeq 轮询），本地事务内 outbox。
- REST：127.0.0.1 + Bearer；`/v1/docs` 浏览页、`/v1/openapi.json`、CLI/MCP spec。
- CLI：全命令 `--help`、`docs`、`doctor`、`spec`、`backup`、`serve`、`mcp`。
- 文档：需求/契约/数据模型/登录/实现设计/审计/进度/性能/运维部署/快速开始 + 自动生成 CLI/REST/MCP 参考。
- 部署：systemd user service、install 脚本、备份恢复说明。
- 测试：13 个文件 / 53 个用例；性能基准脚本。

### 已知限制

- 上游删除客户受账号权限限制（验证账号无删除权限）。
- 完整扫码登录/24h 保活/免扫码重登需人工联调。
- 海关产品/交易分析与贸易监测不在 MVP。

## [1.0.0] - post-release validation (2026-11-15)

- 真实扫码登录 E2E 验证通过（生产账号 online）。
- 生产 REST 客户/海关/心跳验证通过；systemd 部署运行中。
- 新增 `scripts/bench-live.ts`（真实上游延迟基准）与 `scripts/keepalive-watch.ts`（24h 保活观察）。
- 实测筛选后缀：CONTAIN=`_like`、IS=`_eq`、NOT_IN=`_notin`。
- 发现并记录：发起新登录会使旧 token 立即失效（单会话行为）。
