# REST API 参考

> 版本 1.0.7｜OpenAPI: `spec/openapi.json`｜服务地址默认 `http://127.0.0.1:17890`。

鉴权：`Authorization: Bearer <apiToken>`（`/v1/health`、`/v1/docs`、`/v1/openapi.json`、`/v1/spec/*` 免鉴权）。

统一响应 envelope：

```json
{ "ok": true, "data": {}, "meta": { "requestId": "req_...", "specVersion": "...", "durationMs": 12 }, "error": null }
```

| 方法 | 路径 | 说明 | 能力 | 阶段 |
|---|---|---|---|---|
| GET | `/v1/health` | 健康检查：服务/数据库/账号在线状态 | `system.health` | P2 |
| GET | `/v1/status` | 详细状态：账号/池/同步/任务概览 | `system.status` | P2 |
| GET | `/v1/version` | 版本信息：平台版本与 spec 版本 | `system.version` | P2 |
| GET | `/v1/capabilities` | 能力清单：列出全部能力（CLI/REST/MCP 映射） | `system.capabilities` | P2 |
| GET | `/v1/accounts` | 账号列表：列出全部账号与容量 | `account.list` | P2 |
| GET | `/v1/accounts/{accountId}` | 账号详情：按 ID 查询账号与容量 | `account.get` | P2 |
| POST | `/v1/accounts` | 新增账号：登记账号（登录需另行触发） | `account.create` | P2 |
| PATCH | `/v1/accounts/{accountId}` | 更新账号：更新账号属性/状态 | `account.update` | P2 |
| GET | `/v1/accounts/{accountId}/capacity` | 账号容量：容量上限/已用/剩余/来源 | `account.capacity` | P2 |
| GET | `/v1/sessions` | 会话列表：全部账号会话状态 | `session.list` | P3 |
| GET | `/v1/accounts/{accountId}/session` | 会话状态：单账号会话状态 | `session.status` | P3 |
| POST | `/v1/accounts/{accountId}/session/login` | 触发登录：发起扫码/账密登录 | `session.login` | P3 |
| GET | `/v1/accounts/{accountId}/session/qr` | 获取二维码：解码重编码后的登录二维码 | `session.qr` | P3 |
| POST | `/v1/accounts/{accountId}/session/cancel` | 取消登录：取消进行中的登录 | `session.cancel` | P3 |
| POST | `/v1/accounts/{accountId}/session/logout` | 登出：清除本地会话 | `session.logout` | P3 |
| POST | `/v1/accounts/{accountId}/session/heartbeat` | 会话心跳：轻量保活探针（personalsettingGet） | `session.heartbeat` | P3 |
| POST | `/v1/customers/list` | 客户列表：分页/筛选/排序查询客户 | `customer.list` | P4 |
| GET | `/v1/customers/{customerId}` | 客户详情：单个客户详情与保护状态 | `customer.get` | P4 |
| POST | `/v1/customers` | 客户建档：本地优先建档并异步同步上游 | `customer.create` | P5 |
| PATCH | `/v1/customers/{customerId}` | 客户编辑：本地优先编辑并异步同步 | `customer.update` | P5 |
| DELETE | `/v1/customers/{customerId}` | 客户删除：删除（软删进回收站） | `customer.delete` | P5 |
| POST | `/v1/open-sea/list` | 公海列表：公海客户分页/筛选 | `open_sea.list` | P4 |
| POST | `/v1/open-sea/{customerId}/claim` | 领取公海客户：强制查重 + 容量/冷却校验后领取 | `open_sea.claim` | P5 |
| POST | `/v1/open-sea/{customerId}/release` | 释放客户到公海：释放（本地优先 → doPutSeas） | `open_sea.release` | P5 |
| POST | `/v1/dedup/check` | 单条查重：按关键词查重（公司/联系人/电话等） | `dedup.check` | P4 |
| POST | `/v1/dedup/batch` | 批量查重：批量查重（任务化，≤200/批） | `dedup.batch` | P5 |
| GET | `/v1/dedup/history` | 查重历史：近期查重记录 | `dedup.history` | P4 |
| POST | `/v1/contacts/list` | 联系人列表：按客户查询联系人 | `contact.list` | P4 |
| POST | `/v1/contacts` | 新建联系人：本地优先创建联系人 | `contact.create` | P5 |
| PATCH | `/v1/contacts/{contactId}` | 编辑联系人：编辑联系人（本地优先） | `contact.update` | P5 |
| POST | `/v1/followups/list` | 跟进列表：跟进记录分页/筛选 | `followup.list` | P4 |
| POST | `/v1/followups` | 新建跟进：本地优先新建跟进 | `followup.create` | P5 |
| POST | `/v1/customs/query` | 海关公司查询：按公司查询贸易数据（本地缓存） | `customs.query` | P4 |
| GET | `/v1/customs/dictionaries` | 海关字典：国家/HS/数据源字典 | `customs.dictionaries` | P4 |
| GET | `/v1/customs/cache/stats` | 海关缓存统计：命中率/条目/占用 | `customs.cache.stats` | P4 |
| POST | `/v1/customs/cache/purge` | 清理海关缓存：按条件清理缓存 | `customs.cache.purge` | P4 |
| GET | `/v1/tasks/{taskId}` | 任务详情：任务状态/进度/结果 | `task.get` | P4 |
| POST | `/v1/tasks/{taskId}/cancel` | 取消任务：取消排队/运行中的任务 | `task.cancel` | P5 |
| GET | `/v1/tasks` | 任务列表：按状态/类型列出任务 | `task.list` | P4 |
| GET | `/v1/events` | 事件查询：按序号轮询事件（sinceSeq） | `event.list` | P5 |
| POST | `/v1/events/purge` | 事件归档/清理：按类型与时间归档并删除历史事件 | `event.purge` | P6 |
| GET | `/v1/sync/status` | 同步状态：outbox/对账状态 | `sync.status` | P5 |
| POST | `/v1/sync/reconcile` | 触发对账：拉取上游增量并收敛 | `sync.reconcile` | P5 |
| POST | `/v1/sync/outbox/retry` | 重试 outbox：手动重试失败的同步项 | `sync.retry` | P5 |

## 参数

### GET /v1/health

返回平台运行状态：版本、spec 版本、运行时长、数据库是否可用、schema 版本、账号总数与在线数。

无参数。

### GET /v1/status

在健康检查基础上返回账号明细、账号池水位、同步队列与任务统计，用于运维与编排层决策。

无参数。

### GET /v1/version

返回平台版本、spec 版本、Node 版本与 git 提交（若可用）。

无参数。

### GET /v1/capabilities

返回能力注册表：id、标题、说明、参数、CLI 命令、REST 路由、MCP 工具名、实现阶段。用于生成文档与集成。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `category` | query | string | 否 | 按分类过滤 |
| `implemented` | query | boolean | 否 | 仅显示已实现 |

### GET /v1/accounts

返回账号列表：accountId、名称、业务员（不脱敏）、登录方式、状态、容量上限/已用/剩余、来源。

无参数。

### GET /v1/accounts/{accountId}

返回单个账号详情、会话状态摘要与容量（limit/used/remaining/source）。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | path/query | string | 是 | 账号 ID |

### POST /v1/accounts

登记一个账号（仅本地）：账号 ID、名称、业务员、登录方式、钉钉组织、孚盟企业、可选容量覆盖。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | path/query | string | 是 | 账号 ID（如 acct_01） |
| `name` | body | string | 否 | 显示名称 |
| `ownerName` | body | string | 否 | 业务员姓名 |
| `ownerCtId` | body | string | 否 | 孚盟账号 ctId（用于容量统计） |
| `loginMode` | body | string | 否 | 登录方式：dingtalk_sso_qr|password_slider_dingtalk|manual_token |
| `dingtalkOrg` | body | string | 否 | 钉钉组织精确名称 |
| `fumaEnterprise` | body | string | 否 | 孚盟企业精确名称 |
| `capacityLimit` | body | number | 否 | 容量上限覆盖（默认按规则解析） |
| `keepBrowserAlive` | body | boolean | 否 | 该账号登录后是否保持浏览器（默认否） |

### PATCH /v1/accounts/{accountId}

更新账号名称、业务员、登录方式、组织/企业、容量覆盖、状态、是否保持浏览器。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | path/query | string | 是 | 账号 ID |
| `name` | body | string | 否 | 显示名称 |
| `ownerName` | body | string | 否 | 业务员姓名 |
| `ownerCtId` | body | string | 否 | 孚盟账号 ctId |
| `dingtalkOrg` | body | string | 否 | 钉钉组织精确名称 |
| `fumaEnterprise` | body | string | 否 | 孚盟企业精确名称 |
| `status` | body | string | 否 | 状态：inactive|active|degraded|disabled |
| `capacityLimit` | body | number | 否 | 容量上限覆盖 |
| `keepBrowserAlive` | body | boolean | 否 | 是否保持浏览器 |

### GET /v1/accounts/{accountId}/capacity

返回账号客保容量：limit（默认 500，按角色 custLimit 规则解析）、used、remaining、source、lastSyncedAt。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | path/query | string | 是 | 账号 ID |

### GET /v1/sessions

返回各账号会话状态机、token 过期时间、健康度与最近错误。

无参数。

### GET /v1/accounts/{accountId}/session

返回账号登录状态机当前状态、二维码（如就绪）、token 剩余时间、心跳健康度。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | path/query | string | 是 | 账号 ID |

### POST /v1/accounts/{accountId}/session/login

触发账号登录（默认钉钉扫码）。返回当前状态；登录过程需人工扫码时通过 session qr 获取二维码。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | path/query | string | 是 | 账号 ID |
| `mode` | body | string | 否 | 登录方式（可选，默认按账号配置） |

### GET /v1/accounts/{accountId}/session/qr

返回钉钉登录二维码：payload、pngBase64、过期时间、刷新次数；CLI 会同时打印终端二维码。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | path/query | string | 是 | 账号 ID |

### POST /v1/accounts/{accountId}/session/cancel

取消当前账号进行中的登录流程并清理二维码状态。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | path/query | string | 是 | 账号 ID |

### POST /v1/accounts/{accountId}/session/logout

清除账号本地 token/会话（不会强制上游下线）。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | path/query | string | 是 | 账号 ID |

### POST /v1/accounts/{accountId}/session/heartbeat

调用上游轻量只读接口探测会话有效性；记录延迟与健康状态，session_expired 时标记账号过期。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | path/query | string | 是 | 账号 ID |

### POST /v1/customers/list

客户列表（默认本地缓存优先）。支持 filters（字段_操作符，见文档筛选 DSL）与 systemSelection 预置筛选、分页、排序。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | body | string | 否 | 账号 ID（读可路由任意在线账号） |
| `filters` | body | json | 否 | 筛选条件 JSON，如 {"seasFlag_eq":0} |
| `systemSelection` | body | json | 否 | 预置筛选 JSON |
| `page` | body | number | 否 | 页码（从 1 开始） |
| `pageSize` | body | number | 否 | 每页条数（默认 20） |
| `sort` | body | string | 否 | 排序 |
| `fresh` | body | boolean | 否 | 强制上游刷新 |

### GET /v1/customers/{customerId}

客户详情（本地缓存优先，fresh=true 强制上游）：基础信息 + 主联系人 + 归属/保护状态。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `customerId` | path/query | string | 是 | 客户 ID（key_id） |
| `accountId` | query | string | 否 | 账号 ID |
| `fresh` | query | boolean | 否 | 强制上游 |

### POST /v1/customers

客户建档：本地事务写事实 + outbox，立即返回 syncState=pending；异步同步上游。需要 accountId。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | body | string | 是 | 账号 ID（写操作必填） |
| `data` | body | json | 是 | 客户字段 JSON（custName 等） |
| `idempotencyKey` | body | string | 否 | 幂等键 |

### PATCH /v1/customers/{customerId}

客户字段级更新：本地先事实 + outbox；冲突最终收敛上游（sync.conflict 事件）。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | body | string | 是 | 账号 ID（写操作必填） |
| `customerId` | path/query | string | 是 | 客户 ID |
| `data` | body | json | 是 | 待更新字段 JSON |
| `idempotencyKey` | body | string | 否 | 幂等键 |

### DELETE /v1/customers/{customerId}

删除指定客户（上游软删进回收站），需要 accountId。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | body | string | 是 | 账号 ID（写操作必填） |
| `customerId` | path/query | string | 是 | 客户 ID |
| `idempotencyKey` | body | string | 否 | 幂等键 |

### POST /v1/open-sea/list

公海客户列表（seasFlag=1），支持分页、筛选、预置筛选；本地缓存优先。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | body | string | 否 | 账号 ID |
| `filters` | body | json | 否 | 筛选条件 JSON |
| `page` | body | number | 否 | 页码 |
| `pageSize` | body | number | 否 | 每页条数 |
| `fresh` | body | boolean | 否 | 强制上游 |

### POST /v1/open-sea/{customerId}/claim

领取公海客户：强制先查后领（命中→duplicate_customer）；校验容量（按角色规则）、释放冷却（默认 3 天）、公海状态；本地 pending → 上游 doBatchReceive。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | body | string | 是 | 账号 ID（写操作必填） |
| `customerId` | path/query | string | 是 | 客户 ID |
| `idempotencyKey` | body | string | 否 | 幂等键（建议 UUID） |

### POST /v1/open-sea/{customerId}/release

把客户放回公海：本地标记 pending → 上游 doPutSeas/doBatchPutSeas；记录释放时间用于 3 天冷却。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | body | string | 是 | 账号 ID（写操作必填） |
| `customerId` | path/query | string | 是 | 客户 ID |
| `reason` | body | string | 否 | 释放原因 |
| `idempotencyKey` | body | string | 否 | 幂等键 |

### POST /v1/dedup/check

调用上游 repeat/check，返回命中数量；结果落本地快照。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | body | string | 否 | 账号 ID |
| `keywords` | path/query | string | 是 | 关键词 |
| `moduleCode` | body | string | 否 | 模块（默认 NewBF001） |

### POST /v1/dedup/batch

批量查重任务：分片调用上游，结果逐条落库；返回 taskId 供轮询。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | body | string | 否 | 账号 ID |
| `keywords` | body | json | 是 | 关键词数组 JSON |
| `chunkSize` | body | number | 否 | 分片大小（默认 200） |

### GET /v1/dedup/history

查询查重历史（上游 getHistory + 本地快照）。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | query | string | 否 | 账号 ID |
| `moduleCode` | query | string | 否 | 模块 |
| `size` | query | number | 否 | 条数 |

### POST /v1/contacts/list

联系人列表（客户详情 subBill 方式），支持分页与 fresh 强制上游。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | body | string | 否 | 账号 ID |
| `customerId` | body | string | 否 | 客户 ID |
| `page` | body | number | 否 | 页码 |
| `pageSize` | body | number | 否 | 每页条数 |
| `fresh` | body | boolean | 否 | 强制上游刷新 |

### POST /v1/contacts

为指定客户创建联系人（本地先事实 + outbox → 上游 edit_customer 提交 master.contacts；已实测）。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | body | string | 是 | 账号 ID（写操作必填） |
| `customerId` | body | string | 是 | 客户 ID |
| `data` | body | json | 是 | 联系人字段 JSON |

### PATCH /v1/contacts/{contactId}

编辑联系人字段；本地先事实 + outbox。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | body | string | 是 | 账号 ID（写操作必填） |
| `contactId` | path/query | string | 是 | 联系人 ID |
| `data` | body | json | 是 | 字段 JSON |

### POST /v1/followups/list

跟进记录列表（moduleCode=NewBF004），支持按客户/分页/筛选。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | body | string | 否 | 账号 ID |
| `customerId` | body | string | 否 | 客户 ID |
| `page` | body | number | 否 | 页码 |
| `pageSize` | body | number | 否 | 每页条数 |

### POST /v1/followups

新建跟进记录（内容/方式/时间/关联联系人）：本地先事实 + outbox → 上游；成功后更新客户保护期相关字段。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | body | string | 是 | 账号 ID（写操作必填） |
| `customerId` | body | string | 是 | 客户 ID |
| `content` | body | string | 是 | 跟进内容 |
| `method` | body | string | 否 | 跟进方式（如 Call/WeChat） |
| `followedAt` | body | string | 否 | 跟进时间 |
| `nextFollowupAt` | body | string | 否 | 下次跟进时间 |
| `contactId` | body | string | 否 | 关联联系人 ID |

### POST /v1/customs/query

MVP 仅按公司查询（tradeList 公司维度）。强制本地缓存：命中不发上游请求；支持 forceRefresh/allowStale；权限域隔离。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | body | string | 否 | 账号 ID（建议，用于权限校验） |
| `inputCompany` | path/query | string | 是 | 公司关键词（≥2 字符） |
| `companyFlag` | body | number | 否 | 1=进口 2=出口（默认 1） |
| `page` | body | number | 否 | 页码 |
| `pageSize` | body | number | 否 | 每页条数 |
| `forceRefresh` | body | boolean | 否 | 跳过缓存强制上游 |
| `allowStale` | body | boolean | 否 | 上游失败时允许 stale 缓存 |

### GET /v1/customs/dictionaries

返回海关字典：国家列表、HS 编码、数据源导入导出统计、更新日志；本地缓存 TTL 7 天。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | query | string | 否 | 账号 ID |
| `kind` | query | string | 否 | 字典类型：countries|hscode|sources|updatelog |

### GET /v1/customs/cache/stats

返回海关本地缓存统计：条目数、字节数、命中率、最近刷新时间。

无参数。

### POST /v1/customs/cache/purge

清理海关本地缓存：可按 queryType/公司关键词/时间范围；默认清全部过期或指定条件。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `queryType` | body | string | 否 | 缓存类型（company/dict） |
| `company` | body | string | 否 | 公司关键词过滤 |
| `before` | body | string | 否 | 清理该时间之前的缓存 |

### GET /v1/tasks/{taskId}

查询任务状态、进度、结果或错误；支持结果分页读取（task.results）。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `taskId` | path/query | string | 是 | 任务 ID |

### POST /v1/tasks/{taskId}/cancel

取消任务（queued/running），已完成的不能取消。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `taskId` | path/query | string | 是 | 任务 ID |

### GET /v1/tasks

任务列表：支持状态、类型、分页过滤。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `status` | query | string | 否 | 状态过滤 |
| `type` | query | string | 否 | 类型过滤 |
| `page` | query | number | 否 | 页码 |
| `pageSize` | query | number | 否 | 每页条数 |

### GET /v1/events

轮询事件：sinceSeq 之后的事件列表（eventId/seq/type/payload）；消费方按 eventId+seq 幂等。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `sinceSeq` | query | number | 否 | 起始序号（不含） |
| `limit` | query | number | 否 | 最多条数 |
| `type` | query | string | 否 | 事件类型过滤 |

### POST /v1/events/purge

归档/清理历史事件：默认删除 30 天前事件；可按类型过滤、先写 JSONL 归档、dryRun 预览。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `olderThanDays` | body | number | 否 | 删除早于 N 天的事件（0=删除全部早于当前时刻） |
| `before` | body | string | 否 | 绝对截止时间 ISO（优先于 olderThanDays） |
| `types` | body | string | 否 | 事件类型过滤，逗号分隔，如 sync.conflict |
| `archive` | body | string | 否 | 归档 JSONL 路径（删除前写入） |
| `dryRun` | body | boolean | 否 | 只统计不删除 |

### GET /v1/sync/status

同步状态：outbox 队列、失败明细、最近对账时间、差异数。

无参数。

### POST /v1/sync/reconcile

触发对账任务（可选 accountId）：拉取上游事实、diff、收敛到上游、发 sync.conflict 事件。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `accountId` | body | string | 否 | 账号 ID（可选） |
| `scope` | body | string | 否 | 范围：customers|open_sea|followups|capacity |

### POST /v1/sync/outbox/retry

手动重试指定的 outbox 项（失败/重试耗尽）。

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| `outboxId` | body | number | 是 | outbox ID |
