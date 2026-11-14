## [1.0.7] - 2026-11-15

### 新增/清理

- 新增能力 `event.purge`：按类型/时间归档并清理历史事件（支持 `--archive` JSONL、`--dry-run`；CLI/REST/MCP 三入口）。
- 事件自动保留策略：`events.retentionDays=30`、`events.autoPurge=true`，调度器每小时清理过期事件。
- 清理历史 `sync.conflict` 事件 2420 条（已归档到 `~/.fuma-platform/backups/events-sync-conflict-20261115.jsonl`，770KB），清理后剩余 2 条常规事件。
- 新增 events 单测；测试总数 60（16 文件）。

## [1.0.6] - 2026-11-15

### 修复（全面自检）

- MCP：删除 `fuma_system_capabilities` 重复注册（此前 `fuma mcp` 启动即崩溃）；补 MCP 单测。
- Logger：`silentConsole` 从不生效导致 MCP stdout 混入日志行（违反 stdio JSON-RPC 协议）；修复并补 logger 单测。
- 对账：ID 归一化（`13148056.0` → `13148056`），修复每 5 分钟 200 条伪 `sync.conflict`；清理历史 2420 条 diff，reconcile 实测 diffs=0。
- 调度器：启动 3s 后立即心跳，避免频繁重启导致保活空档。
- 对账分页：从只查前 200 改为分页拉取（最多 5×200），手动对账 checked=491、diffs=0。
- 容量刷新上游请求超时下调到 5s（避免网络异常时拖慢 `account.list`）。
- 文档：README/docs/README/docs/10 版本、测试数（58）、验证表述更新；账号名称修正为宋释孟。

## [1.0.5] - 2026-11-15

### 新增/修复

- `account create/update` 支持 `--owner-ct-id`（孚盟 ctId，用于容量统计），update 同时支持 `--dingtalk-org`/`--fuma-enterprise`。
- 生产账号 acct_01 已更新为真实业务员：`宋释孟`（ownerCtId=13148056），容量统计正常。

## [1.0.3] - 2026-11-15

### 修复

- 安装脚本自动把 `fuma` 启动器安装到 `~/.local/bin/fuma`（软链），启动器支持 symlink 解析并静默实验特性警告。
- README/快速开始/运维手册补充 CLI 安装与 PATH 说明。

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

## [1.0.1] - 2026-11-15

### 修复/验证

- 联系人新增同步改为 `edit_customer(master.contacts)` 方案，真实上游验证成功。
- `contact.list` 增加并透传 `fresh` 参数，修复 REST 层丢弃未声明参数导致无法强制刷新。
- 新增 README 配图（MiniMax-H3-Image 生成）与可视化改版。
- 记录跟进新增接口契约待补（本地优先实现保留，outbox 标记 dead）。

## [1.0.2] - 2026-11-15

### 新增/修复（真实上游验证）

- 跟进新增打通真实上游：同步改为 `POST /bill/bill/add_one`（浏览器抓包确认的完整 body），
  平台创建 → outbox → 上游可查（2 条 ZZ_TEST 测试跟进需管理员清理）。
- `followup.list --customer` 过滤修复：改用 `searchFieldCondition.custId_eq`（`subBill` 方式 1007）。
- 新增跟进同步单元测试；测试总数 54。
- 联系人/跟进新增均完成真实上游验证；README 验证表、docs/03、docs/10 同步更新。

## [1.0.4] - 2026-11-15

### 修复

- 容量视图修正：`capacity.used` 改为优先取上游按 owner 统计的客户数（缓存 120s，`usedSource=upstream`），
  不再直接统计本地缓存 customers（之前会显示 200 而非真实 491）。
- `account.list/get` 自动刷新容量使用量；失败回退本地估算并标记 `usedSource=local_cache`。
- README 版本、docs/05、docs/10 更新；待补：角色→custLimit 规则同步（limit 目前默认 500）。
