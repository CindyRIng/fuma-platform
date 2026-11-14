# 04 平台 API 契约（对外）

> 本契约定义 fuma-platform 对外能力：CLI / REST / MCP / SKILL 四入口共享同一套语义。
> 原则：**薄封装上游、原子命令、幂等、可任务化、不编排业务**。
> 版本：v7（v1 基线 + v3/v6/v7 增量附录；决策已落库；含海关缓存契约）。

## 1. 设计原则

1. **忠实映射孚盟语义**：不发明业务概念；命令与孚盟操作一一对应（客户/公海/查重/联系人/跟进/海关）。
2. **原子命令 + 查询 + 事件**，不提供端到端业务流程。
3. **写操作必须显式传 `accountId`**；平台只校验和执行，不替调用方选账号。
4. **本地优先**：写命令立即落本地事实并返回（`syncState=pending`），异步同步上游；同步失败可查询/重试。
5. **幂等**：写命令支持 `idempotencyKey`；重复提交返回同一结果。
6. **可观测**：每个响应带 `requestId` + `meta`；事件可追踪。
7. **契约稳定**：四入口由同一 spec 生成，保证一致。

## 2. 版本与兼容

- API 版本：`/v1`（REST 路径）；CLI 无版本前缀但遵循同一 spec 版本。
- 响应含 `meta.specVersion`（如 `2026-11-14.1`）。
- 向后兼容：只增字段不改语义；破坏性变更升 `/v2`。
- 上游变更在适配层消化，不改变对外契约。

## 3. 鉴权与访问

| 入口 | 鉴权 |
|---|---|
| CLI | 本机用户执行（无额外鉴权；配置文件权限 600） |
| REST | 仅监听 `127.0.0.1`；`Authorization: Bearer <API_TOKEN>` |
| MCP | stdio（由宿主进程管理，无网络暴露） |
| SKILL | 通过 CLI/REST/MCP 调用 |

- `API_TOKEN` 在首次启动生成，存 `~/.fuma-platform/config.json`（600）。
- 所有入口的敏感字段（token/cookie）在响应中脱敏（仅尾 4 位）。

## 4. 统一响应 envelope

```json
{
  "ok": true,
  "data": { },
  "meta": {
    "requestId": "req_...",
    "specVersion": "2026-11-14.1",
    "accountId": "acct_01",
    "durationMs": 132
  },
  "error": null
}
```

失败：

```json
{
  "ok": false,
  "data": null,
  "meta": { "requestId": "req_...", "specVersion": "2026-11-14.1" },
  "error": {
    "code": "capacity_exceeded",
    "message": "账号 acct_01 保护客户已达上限 500",
    "retryable": false,
    "details": { "accountId": "acct_01", "limit": 500, "used": 500 }
  }
}
```

### 4.1 错误码

| code | HTTP | 含义 | 可重试 |
|---|---|---|---|
| `invalid_argument` | 400 | 参数错误 | 否 |
| `unauthorized` | 401 | 入口鉴权失败 | 否 |
| `not_found` | 404 | 资源不存在（账号/客户/任务） | 否 |
| `conflict` | 409 | 幂等键冲突/状态冲突 | 否 |
| `capacity_exceeded` | 409 | 账号保护容量已满 | 否 |
| `cooldown_active` | 409 | 释放后 3 天冷却 | 否 |
| `duplicate_customer` | 409 | 查重命中/重复建档 | 否 |
| `permission_denied` | 403 | 上游权限不足 | 否 |
| `session_expired` | 401 | 账号会话过期/失效 | 是（重登后） |
| `account_busy` | 429 | 账号被限流/忙碌 | 是（retryAfterMs） |
| `upstream_error` | 502 | 上游业务/系统错误 | 视情况 |
| `rate_limited` | 429 | 池级限流 | 是（retryAfterMs） |
| `task_cancelled` | 409 | 任务已取消 | 否 |
| `timeout` | 504 | 超时 | 是 |
| `internal_error` | 500 | 平台内部错误 | 视情况 |

## 5. 通用参数规范

- 时间：ISO 8601（`2026-11-14T21:30:00+08:00`）；上游时间字符串在 `data` 内保留原样。
- ID：`accountId`（本地账号 id，如 `acct_01`）；`customerId` 为上游 `key_id`/`main_id` 字符串。
- 分页：`page`（从 1 开始）、`pageSize`（默认 20，最大 200）；响应 `data.list` + `meta.totalNum` + `meta.page/pageSize`。
- 过滤：`filters.<field>_<op>`（`eq/like/in/gte/lte`），如 `filters.seas_flag_eq=1`。
- 排序：`sort=field:asc|desc`。
- 幂等：写命令可带 `idempotencyKey`（建议 UUID）；同 key 同参数 → 返回首次结果。
- 字段选择：`fields=key_id,custName,...`（可选，减少传输）。

## 6. 四入口映射规范

### 6.1 CLI

```
fuma <noun> <verb> [options]
fuma account list
fuma session login --account acct_01 --mode qr
fuma customer list --account acct_01 --page 1 --page-size 20
fuma open-sea claim --account acct_01 --customer-id <key_id> --idempotency-key <uuid>
fuma task get --task-id task_...
```
- 输出：默认 envelope JSON；`--format table` 简表；`--quiet` 只出 data。
- 退出码：0 成功；2 参数错误；3 业务错误；4 上游错误；5 内部错误。

### 6.2 REST（127.0.0.1:17890，示例端口）

| 方法 | 路径 | 能力 |
|---|---|---|
| GET | `/v1/health` | 健康检查 |
| GET | `/v1/accounts` | 账号列表 |
| POST | `/v1/accounts` | 新增账号 |
| GET | `/v1/accounts/{accountId}` | 账号详情/容量/状态 |
| POST | `/v1/accounts/{accountId}/session/login` | 触发登录 |
| GET | `/v1/accounts/{accountId}/session/qr` | 二维码（payload+base64） |
| GET | `/v1/accounts/{accountId}/session` | 登录状态 |
| POST | `/v1/accounts/{accountId}/session/logout` | 登出 |
| POST | `/v1/customers/list` | 客户列表（POST 便于复杂过滤） |
| GET | `/v1/customers/{customerId}` | 客户详情 |
| POST | `/v1/customers` | 客户建档 |
| PATCH | `/v1/customers/{customerId}` | 客户编辑 |
| POST | `/v1/open-sea/list` | 公海列表 |
| POST | `/v1/open-sea/{customerId}/claim` | 领取（body: accountId） |
| POST | `/v1/open-sea/{customerId}/release` | 释放 |
| POST | `/v1/dedup/check` | 单条查重 |
| POST | `/v1/dedup/batch` | 批量查重（返回 task） |
| GET | `/v1/dedup/history` | 查重历史 |
| POST | `/v1/dedup/refresh` | 触发/安排复核 |
| POST | `/v1/contacts/list` / `GET /v1/contacts/{id}` / `POST /v1/contacts` / `PATCH` | 联系人 |
| POST | `/v1/followups/list` / `POST /v1/followups` / `PATCH /v1/followups/{id}` | 跟进 |
| POST | `/v1/customs/query` | 海关查询（task） |
| GET | `/v1/customs/dictionaries` | 国家/HS/数据源字典 |
| POST | `/v1/trade-monitor/list` | 贸易监测列表 |
| GET | `/v1/tasks/{taskId}` | 任务状态/结果 |
| POST | `/v1/tasks/{taskId}/cancel` | 取消任务 |
| GET | `/v1/events` | 事件查询（since/seq） |
| POST | `/v1/events/subscriptions` | 配置 webhook 订阅 |
| GET | `/v1/sync/status` | 同步/对账状态 |
| POST | `/v1/sync/reconcile` | 触发对账 |

### 6.3 MCP

- tool 命名：`fuma_<noun>_<verb>`，如 `fuma_session_login`、`fuma_customer_list`、`fuma_open_sea_claim`。
- 输入 schema 与 REST 请求 body 对齐（zod → JSON Schema 自动生成）。
- 危险写操作（claim/release/批量删除）在 tool 描述中标注风险与幂等要求。
- MCP 服务以 stdio 方式运行，不监听端口。

### 6.4 SKILL

`skills/fuma-platform/SKILL.md`：说明如何通过 CLI/REST/MCP 完成常见任务（登录、查客户、领取、查重、海关查询），不重复实现逻辑。

## 7. 能力契约（逐个定义）

> 所有能力含：CLI/REST/MCP 映射、输入、输出、错误、幂等、备注。
> `accountId` 写操作必填。

### 7.1 系统

#### `system.health`
- CLI：`fuma health`；REST：`GET /v1/health`
- 输出：`{ status: "ok", version, uptime, db: "ok", accountsOnline: N, pool: {...} }`

#### `system.status`
- CLI：`fuma status`；REST：`GET /v1/status`
- 输出：账号在线/失效数、同步队列积压、任务数、请求池水位、上游健康探测。

### 7.2 账号（account）

#### `account.list` / `account.get`
- 输出：`{ accountId, name, ownerName, status, capacity: {limit, used}, session: {state, expiresAt}, loginMode }`
- 错误：`not_found`

#### `account.create` / `account.update`
- 输入：`{ name, loginMode, dingtalkOrgName, fumaEnterpriseName, capacityLimit?, proxy? }`
- 备注：仅本地登记；登录由 session.login 触发。

#### `account.capacity`
- 输出：`{ limit, used, remaining, source, lastSyncedAt }`；limit 按「角色→custLimit 规则」计算（实测 300/200/500），读不到回退默认 500 并标 `source=default`

### 7.3 会话（session）

#### `session.login`
- CLI：`fuma session login --account A [--mode qr|password]`；REST：`POST /v1/accounts/{A}/session/login`
- 输出：`{ state: "starting" }`（异步）；或直接返回 `qr`（若 QR 已就绪）
- 错误：`account_busy`（同账号登录中）

#### `session.qr`
- 输出：`{ payload, pngBase64, ascii?, expiresAt, refreshCount, state }`
- 说明：payload 可复制；base64 可直接渲染；CLI 打印 ANSI 二维码。

#### `session.status` / `session.cancel` / `session.logout`
- status：`{ state, mode, accountId, qr?, startedAt, lastError? }`
- 事件：状态变化发布 `session.login.*` / `session.state.changed`。

### 7.4 客户（customer）

#### `customer.list`
- 输入：`{ accountId?, filters?, page, pageSize, sort?, fields? }`
- 说明：读任务可路由任意在线账号（默认使用本地缓存优先，可 `fresh=true` 强制上游）；写/敏感操作必须指定账号。
- 筛选：`filters`（字段_操作符）与 `systemSelection`（预置客群/系统筛选）均支持，见 03 §A。
- 输出：`{ list: Customer[], totalNum }`
- Customer 字段见 `03-上游接口契约` 字段字典（对外使用稳定命名，不直接暴露上游原始 key 以外的混乱字段；建议同时保留 `raw` 可选）。

#### `customer.get`
- 输入：`{ customerId, accountId? }`
- 输出：`{ customer, protection: { ownerAccountId, seasFlag, willInSeaAt, lastTrackAt } }`

#### `customer.create`
- 输入：`{ accountId, customer: { custName, countryId?, custSource?, custLevel?, web?, tel?, mobile?, ... }, idempotencyKey? }`
- 行为：**本地先落事实（pending）→ 异步同步上游**；返回 `{ customerId, syncState }`
- 校验：必填字段、查重（可选强制）、账号容量/权限
- 错误：`duplicate_customer`、`capacity_exceeded`、`permission_denied`

#### `customer.update`
- 输入：`{ accountId, customerId, patch, idempotencyKey? }`
- 行为：本地更新 + outbox；冲突按 `05` 冲突矩阵处理。

### 7.5 公海（open_sea）

#### `open_sea.list`
- 输入：`{ filters?, page, pageSize }`（默认 `seasFlag=1`）
- 输出：`{ list, totalNum }`（实测全量 379,597）

#### `open_sea.claim`
- 输入：`{ accountId, customerId, idempotencyKey }`
- 校验（本地）：账号在线、容量 < 账号实际上限（默认 500，按「角色→custLimit 规则」解析）、冷却（默认 3 天，上游规则）、客户当前在公海（本地快照）、未重复领取
- 行为：本地先标记归属（pending）→ 上游 `doReceive` → 成功 synced / 失败回滚+告警
- 输出：`{ customerId, accountId, syncState }`
- 错误：`capacity_exceeded`、`cooldown_active`、`conflict`、`session_expired`

#### `open_sea.release`
- 输入：`{ accountId, customerId, reason?, idempotencyKey }`
- 行为：本地标记公海（pending）→ 上游 `doPutSeas`；记录公海日志
- 备注：释放后该账号 3 天冷却由本地规则引擎记录并可校验。

#### `open_sea.batch_claim` / `batch_release`
- 返回 `taskId`（任务化）；结果含成功/失败明细。

### 7.6 查重（dedup）

#### `dedup.check`
- 输入：`{ accountId?, keywords, moduleCode?="NewBF001", options?: { ignore, querySuffix, mutual, type } }`
- 输出：`{ count, hits?, checkedAt, snapshotId }`
- 说明：结果写本地快照；读任务可路由任意账号。

#### `dedup.batch`
- 输入：`{ keywords: string[] (≤200), options?, chunkSize? }`
- 返回 `taskId`；任务内分片循环，结果逐条落库。
- 备注：孚盟 UI 批量上限 200；平台按批分片。

#### `dedup.history`
- 输入：`{ moduleCode?, size? }`；输出历史记录（只读）。

#### `dedup.refresh`
- 输入：`{ customerIds?: string[], olderThanHours?: number }`
- 返回 `taskId`；用于定期复核，变化发 `dedup.result.changed` 事件。

### 7.7 联系人（contact）

- `contact.list`：`{ accountId?, customerId?, filters?, page, pageSize }`
- `contact.get`：`{ contactId }`
- `contact.create`：`{ accountId, customerId, contact: { name, email?, whatsapp?, mobile?, position?, decisionRole?, ... } }`（本地优先）
- `contact.update` / `contact.set_primary`

### 7.8 跟进（followup）

- `followup.list`：`{ accountId?, customerId?, filters?, page, pageSize }`
- `followup.create`：`{ accountId, customerId, followup: { method, content, followedAt?, nextFollowupAt?, contactId?, relatedModule?, relatedId? }, idempotencyKey }`
  - 本地优先；成功同步后更新客户保护期相关字段（willInSeaAt）
- `followup.update`

### 7.9 海关数据（customs）

#### `customs.query`
- 输入：
  ```json
  { "accountId?": "acct_01", "queryType": "company" /* MVP 仅公司查询；product/source/analysis 返回 invalid_argument */,
    "params": { "keyword": "...", "hsCode": "...", "countryCode": "...", "dateFrom": "...", "dateTo": "..." },
    "page": 1, "pageSize": 20 }
  ```
- 输出：`{ taskId }`（大结果任务化）或同步结果（小查询）
- 错误：`permission_denied`（数据权限不足）、`rate_limited`
- 备注：公司维度契约已完整（tradeList DSL）；「按产品/交易分析」请求契约待 P2 补抓或降级，见 03 §5.7。

#### `customs.dictionaries`
- 输出：国家、HS 编码、数据源、更新日志（本地缓存 + TTL）

#### `customs.task_result`
- `GET /v1/tasks/{taskId}` 返回 `{ status, progress, result: { list, totalNum } }`

### 7.10 贸易监测（不进 MVP，P3 候选）

- 不对外暴露；P3 若要接入，只读 `trade_monitor.list/stats/insights`。

### 7.11 任务（task）

状态机：`queued → running → succeeded | failed | cancelled | partial`

```
POST /v1/dedup/batch        → { taskId }
GET  /v1/tasks/{taskId}     → { status, progress: {done,total}, result|error, createdAt, finishedAt }
POST /v1/tasks/{taskId}/cancel
```
- 幂等：创建任务支持 `idempotencyKey`。
- 结果分页：`GET /v1/tasks/{taskId}/results?page=...&pageSize=...`
- 重启恢复：任务持久化；running 任务标记 `interrupted` 并可按策略自动重跑（实现阶段定）。

### 7.12 事件（event）

- `GET /v1/events?sinceSeq=...&limit=...` → 事件列表（消费方轮询）
- `POST /v1/events/subscriptions` → 配置 webhook（url、事件类型、HMAC secret）
- webhook 请求头：`X-Fuma-Signature: hmac-sha256(secret, timestamp + "." + body)`、`X-Fuma-Event-Id`
- 重放：`POST /v1/events/{eventId}/replay`（可选）

### 7.13 同步（sync）

- `GET /v1/sync/status` → 队列长度、失败数、最近对账时间、差异数
- `POST /v1/sync/reconcile` → 触发对账任务（accountId 可选）
- `POST /v1/sync/outbox/{id}/retry`

## 8. 事件类型与 payload

| 事件 | 触发 | payload 关键字段 |
|---|---|---|
| `session.state.changed` | 会话状态变化 | accountId, from, to, mode |
| `session.qr.ready` | 二维码就绪/刷新 | accountId, payload, expiresAt, refreshCount |
| `session.expired` | 会话过期 | accountId, expiresAt |
| `customer.created` | 本地建档 | customerId, accountId, syncState |
| `customer.updated` | 本地编辑 | customerId, accountId, changedFields |
| `customer.synced` | 上游同步完成 | customerId, accountId, upstreamId |
| `customer.sync_failed` | 同步失败 | customerId, accountId, error |
| `open_sea.claimed` | 领取 | customerId, accountId |
| `open_sea.released` | 释放 | customerId, accountId, reason |
| `protection.expiring` | 即将掉保（如 <3 天） | customerId, willInSeaAt |
| `protection.expired` | 已掉公海 | customerId, seasFlag |
| `dedup.result.changed` | 查重结果变化 | customerId/keywords, oldCount, newCount |
| `customs.query.completed` | 海关查询完成 | taskId, queryType, count, cached, cacheRefreshed |
| `sync.conflict` | 对账冲突 | entity, localValue, upstreamValue |
| `task.state.changed` | 任务状态 | taskId, from, to |

事件 envelope：

```json
{
  "eventId": "evt_...", "seq": 12345, "type": "customer.updated",
  "occurredAt": "2026-11-14T21:30:00+08:00", "schemaVersion": "1",
  "accountId": "acct_01",
  "payload": { }
}
```

## 9. 重试与限流语义

- 错误带 `retryable` 与可选 `retryAfterMs`。
- 平台内部：RequestPool 按账号限速 + 池级并发；客户端重试应使用指数退避（建议 1s/2s/4s，最多 3 次，非幂等写不要盲目重试）。
- 读接口可重试；写接口必须带 `idempotencyKey` 才安全重试。

## 10. 契约测试与 spec 生成

- `spec/openapi.json`、`spec/cli-commands.json`、`spec/mcp-tools.json` 由单一能力定义（zod schema）生成。
- CI 校验：实现接口与 spec 一致（`gen:check`）。
- 上游契约测试：每日/发版后跑只读探针（客户列表/查重/公海/海关初始化），失败告警。

## 11. 示例

### 11.1 登录
```
$ fuma session login --account acct_01 --mode qr
{"ok":true,"data":{"state":"starting"},"meta":{...}}

$ fuma session qr --account acct_01
{"ok":true,"data":{"payload":"https://login.dingtalk.com/oauth2/qr_confirm.htm?code=...",
"pngBase64":"iVBOR...","expiresAt":"...","refreshCount":0},"meta":{...}}
```

### 11.2 领取公海客户
```
$ fuma open-sea claim --account acct_01 --customer-id 123456 --idempotency-key 9f2...
{"ok":true,"data":{"customerId":"123456","accountId":"acct_01","syncState":"pending"},"meta":{...}}
```

### 11.3 批量查重
```
$ fuma dedup batch --file keywords.txt --chunk-size 200
{"ok":true,"data":{"taskId":"task_abc"},"meta":{...}}

$ fuma task get --task-id task_abc
{"ok":true,"data":{"status":"succeeded","progress":{"done":200,"total":200},"result":{...}}}
```

### 11.4 海关查询
```
$ fuma customs query --type company --keyword "ABC Trading" --page 1 --page-size 20
{"ok":true,"data":{"taskId":"task_cus_1"}}
```

---

## 附：v3 契约增补（筛选/容量/错误）

### 筛选参数（customer.list / open_sea.list 等）

```jsonc
{
  "filters": { "seasFlag_eq": 1 },                       // 自定义条件（字段_操作符）
  "systemSelection": { "selectionId": "...", "selectionType": 8 },  // 系统预置筛选/客群
  "page": 1, "pageSize": 20, "sort": "create_date:desc"
}
```
- 平台对外暴露：`filters`（映射上游 searchFieldCondition）、`systemSelection`（映射上游）、`fields`（字段选择）。
- 支持的操作符元数据来自上游 `getAllSelectionOperatorV1`（51 字段 × 48 comparator），
  对外统一为小写后缀（eq/in/not_in/contain/is/is_not/between/before/after/null/not_null 等），
  细节后缀映射在 contracts 层（docs/03 §A）维护。

### 容量

`GET /v1/accounts/{accountId}` 返回 `capacity: {limit, used, remaining, source: "upstream|cache|default"}`；
limit 由「角色→custLimit 规则」计算（实测 300/200/500 三档），不是固定 500。

### 错误码增补

| code | 上游 | 含义 |
|---|---|---|
| `upstream_error` | 1004（含 serverMsgs 堆栈） | 上游微服务异常，不重试，告警 |

---

## 附：v6 决策后契约更新（2026-11-14 23:35）

### 领取（open_sea.claim）
- 输入不变；**强制先查后领**：
  1. 领取前先执行查重（keywords=客户名称或调用方提供）；命中 → `duplicate_customer`（不写上游）；
  2. 通过后做容量/冷却/公海状态校验 → 本地 pending → `doBatchReceive`（单条=单元素数组）。
- 不做审批状态；无二次确认。
- 冲突处理：本地先事实；对账后**收敛到上游**（`sync.conflict` 事件），不回滚已返回结果。

### 海关（customs）
- MVP 仅 `queryType: "company"`（按公司查询，tradeList DSL）。
- `product/source/analysis` 返回 `invalid_argument`（未启用）；字典接口保留。
- 贸易监测接口不对外暴露（P3 候选）。

### 账号（account）
- `account.list/get` 返回**不脱敏**的 ownerName/ownerCtId 等信息。
- 无审批/无二次确认字段。

### 事件（event）
- MVP 以轮询 `GET /v1/events?sinceSeq=` 为主；`POST /v1/events/subscriptions` 保留但默认不启用。

### 会话（session）
- 浏览器非必需：业务调用为纯 HTTP（token 注入）；登录/重登时才拉起浏览器（见 06 v4）。

---

## 附：v7 海关缓存契约增补（2026-11-14 23:55）

### `customs.query` 入参扩展
```jsonc
{
  "accountId": "acct_01",              // 建议必填（权限校验）；纯缓存读取需 CM 配置
  "queryType": "company",              // MVP 仅 company
  "params": { "inputCompany": "Ningbo", "companyFlag": 1, "smartSearchFlag": 1,
              "filters": { "importerName": {...}, "exporterName": {...} } },
  "page": 1, "pageSize": 20,
  "cache": { "useCache": true, "forceRefresh": false, "allowStale": true }
}
```
### 输出（envelope.data）
```jsonc
{
  "list": [ /* 提单/公司记录 */ ],
  "totalNum": 19504037,
  "source": "cache",                   // upstream | cache
  "cached": true,
  "cachedAt": "2026-11-14T23:00:00+08:00",
  "expiresAt": "2026-11-15T23:00:00+08:00",
  "stale": false,
  "upstreamVersion": "5599164886"
}
```
### 新增能力
- `customs.cache.stats`：`GET /v1/customs/cache/stats` → 命中率/条目/占用/最近刷新。
- `customs.cache.purge`：`POST /v1/customs/cache/purge`（`{queryType?, company?, before?}`）。
- 语义：缓存命中不写事件；刷新/失效后发布 `customs.query.completed`（payload 增 `cached`、`cacheRefreshed`）。
- 权限：带 accountId → 校验该账号权限，无权限即使命中缓存返回 `permission_denied`；不带 accountId 默认不允许纯缓存读取。
- 并发：相同 cacheKey 的在途请求合并为一次上游调用。
