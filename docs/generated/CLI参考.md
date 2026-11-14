# CLI 参考（fuma）

> 版本 1.0.0｜spec 2026-11-15.1｜由 `npm run docs:gen` 生成，请勿手改。

全局选项：`--home <dir>`、`--format json|table`、`--quiet`、`--debug`、`--json`（单命令强制 JSON）。

常用特殊命令：`fuma serve`、`fuma mcp`、`fuma spec`、`fuma docs`、`fuma doctor`、`fuma backup`、`fuma version`。

## 命令一览

| 命令 | 说明 | 阶段 | 已实现 |
|---|---|---|---|
| `fuma system health` | 健康检查：服务/数据库/账号在线状态 | P2 | ✅ |
| `fuma system status` | 详细状态：账号/池/同步/任务概览 | P2 | ✅ |
| `fuma system version` | 版本信息：平台版本与 spec 版本 | P2 | ✅ |
| `fuma system capabilities` | 能力清单：列出全部能力（CLI/REST/MCP 映射） | P2 | ✅ |
| `fuma account list` | 账号列表：列出全部账号与容量 | P2 | ✅ |
| `fuma account get` | 账号详情：按 ID 查询账号与容量 | P2 | ✅ |
| `fuma account create` | 新增账号：登记账号（登录需另行触发） | P2 | ✅ |
| `fuma account update` | 更新账号：更新账号属性/状态 | P2 | ✅ |
| `fuma account capacity` | 账号容量：容量上限/已用/剩余/来源 | P2 | ✅ |
| `fuma session list` | 会话列表：全部账号会话状态 | P3 | ✅ |
| `fuma session status` | 会话状态：单账号会话状态 | P3 | ✅ |
| `fuma session login` | 触发登录：发起扫码/账密登录 | P3 | ✅ |
| `fuma session qr` | 获取二维码：解码重编码后的登录二维码 | P3 | ✅ |
| `fuma session cancel` | 取消登录：取消进行中的登录 | P3 | ✅ |
| `fuma session logout` | 登出：清除本地会话 | P3 | ✅ |
| `fuma session heartbeat` | 会话心跳：轻量保活探针（personalsettingGet） | P3 | ✅ |
| `fuma customer list` | 客户列表：分页/筛选/排序查询客户 | P4 | ✅ |
| `fuma customer get` | 客户详情：单个客户详情与保护状态 | P4 | ✅ |
| `fuma customer create` | 客户建档：本地优先建档并异步同步上游 | P5 | ✅ |
| `fuma customer update` | 客户编辑：本地优先编辑并异步同步 | P5 | ✅ |
| `fuma customer delete` | 客户删除：删除（软删进回收站） | P5 | ✅ |
| `fuma open-sea list` | 公海列表：公海客户分页/筛选 | P4 | ✅ |
| `fuma open-sea claim` | 领取公海客户：强制查重 + 容量/冷却校验后领取 | P5 | ✅ |
| `fuma open-sea release` | 释放客户到公海：释放（本地优先 → doPutSeas） | P5 | ✅ |
| `fuma dedup check` | 单条查重：按关键词查重（公司/联系人/电话等） | P4 | ✅ |
| `fuma dedup batch` | 批量查重：批量查重（任务化，≤200/批） | P5 | ✅ |
| `fuma dedup history` | 查重历史：近期查重记录 | P4 | ✅ |
| `fuma contact list` | 联系人列表：按客户查询联系人 | P4 | ✅ |
| `fuma contact create` | 新建联系人：本地优先创建联系人 | P5 | ✅ |
| `fuma contact update` | 编辑联系人：编辑联系人（本地优先） | P5 | — |
| `fuma followup list` | 跟进列表：跟进记录分页/筛选 | P4 | ✅ |
| `fuma followup create` | 新建跟进：本地优先新建跟进 | P5 | ✅ |
| `fuma customs query` | 海关公司查询：按公司查询贸易数据（本地缓存） | P4 | ✅ |
| `fuma customs dictionaries` | 海关字典：国家/HS/数据源字典 | P4 | ✅ |
| `fuma customs cache-stats` | 海关缓存统计：命中率/条目/占用 | P4 | ✅ |
| `fuma customs cache-purge` | 清理海关缓存：按条件清理缓存 | P4 | ✅ |
| `fuma task get` | 任务详情：任务状态/进度/结果 | P4 | ✅ |
| `fuma task cancel` | 取消任务：取消排队/运行中的任务 | P5 | ✅ |
| `fuma task list` | 任务列表：按状态/类型列出任务 | P4 | ✅ |
| `fuma event list` | 事件查询：按序号轮询事件（sinceSeq） | P5 | ✅ |
| `fuma sync status` | 同步状态：outbox/对账状态 | P5 | ✅ |
| `fuma sync reconcile` | 触发对账：拉取上游增量并收敛 | P5 | ✅ |
| `fuma sync retry` | 重试 outbox：手动重试失败的同步项 | P5 | ✅ |

## 命令详情

### undefined

**健康检查** — 服务/数据库/账号在线状态

返回平台运行状态：版本、spec 版本、运行时长、数据库是否可用、schema 版本、账号总数与在线数。

```bash
fuma system health
```

### undefined

**详细状态** — 账号/池/同步/任务概览

在健康检查基础上返回账号明细、账号池水位、同步队列与任务统计，用于运维与编排层决策。

```bash
fuma system status
```

### undefined

**版本信息** — 平台版本与 spec 版本

返回平台版本、spec 版本、Node 版本与 git 提交（若可用）。

```bash
fuma system version
```

### undefined

**能力清单** — 列出全部能力（CLI/REST/MCP 映射）

返回能力注册表：id、标题、说明、参数、CLI 命令、REST 路由、MCP 工具名、实现阶段。用于生成文档与集成。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `--category <name>` | string | 否 | 按分类过滤 |
| `--implemented` | boolean | 否 | 仅显示已实现 |

```bash
fuma system capabilities
```

### undefined

**账号列表** — 列出全部账号与容量

返回账号列表：accountId、名称、业务员（不脱敏）、登录方式、状态、容量上限/已用/剩余、来源。

```bash
fuma account list
```

### undefined

**账号详情** — 按 ID 查询账号与容量

返回单个账号详情、会话状态摘要与容量（limit/used/remaining/source）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `accountId` | string | 是 | 账号 ID |

```bash
fuma account get acct_01
```

### undefined

**新增账号** — 登记账号（登录需另行触发）

登记一个账号（仅本地）：账号 ID、名称、业务员、登录方式、钉钉组织、孚盟企业、可选容量覆盖。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `accountId` | string | 是 | 账号 ID（如 acct_01） |
| `--name <name>` | string | 否 | 显示名称（默认 `""`） |
| `--owner-name <name>` | string | 否 | 业务员姓名 |
| `--login-mode <mode>` | string | 否 | 登录方式：dingtalk_sso_qr|password_slider_dingtalk|manual_token（默认 `"dingtalk_sso_qr"`） |
| `--dingtalk-org <name>` | string | 否 | 钉钉组织精确名称 |
| `--fuma-enterprise <name>` | string | 否 | 孚盟企业精确名称 |
| `--capacity-limit <n>` | number | 否 | 容量上限覆盖（默认按规则解析） |
| `--keep-browser-alive` | boolean | 否 | 该账号登录后是否保持浏览器（默认否）（默认 `false`） |

```bash
fuma account create acct_01 --name "账号1"
```

### undefined

**更新账号** — 更新账号属性/状态

更新账号名称、业务员、登录方式、组织/企业、容量覆盖、状态、是否保持浏览器。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `accountId` | string | 是 | 账号 ID |
| `--name <name>` | string | 否 | 显示名称 |
| `--owner-name <name>` | string | 否 | 业务员姓名 |
| `--status <status>` | string | 否 | 状态：inactive|active|degraded|disabled |
| `--capacity-limit <n>` | number | 否 | 容量上限覆盖 |
| `--keep-browser-alive <bool>` | boolean | 否 | 是否保持浏览器 |

```bash
fuma account update acct_01 --status active
```

### undefined

**账号容量** — 容量上限/已用/剩余/来源

返回账号客保容量：limit（默认 500，按角色 custLimit 规则解析）、used、remaining、source、lastSyncedAt。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `accountId` | string | 是 | 账号 ID |

```bash
fuma account capacity acct_01
```

### undefined

**会话列表** — 全部账号会话状态

返回各账号会话状态机、token 过期时间、健康度与最近错误。

```bash
fuma session list
```

### undefined

**会话状态** — 单账号会话状态

返回账号登录状态机当前状态、二维码（如就绪）、token 剩余时间、心跳健康度。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `accountId` | string | 是 | 账号 ID |

```bash
fuma session status acct_01
```

### undefined

**触发登录** — 发起扫码/账密登录

触发账号登录（默认钉钉扫码）。返回当前状态；登录过程需人工扫码时通过 session qr 获取二维码。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `accountId` | string | 是 | 账号 ID |
| `--mode <mode>` | string | 否 | 登录方式（可选，默认按账号配置） |

```bash
fuma session login acct_01
```

### undefined

**获取二维码** — 解码重编码后的登录二维码

返回钉钉登录二维码：payload、pngBase64、过期时间、刷新次数；CLI 会同时打印终端二维码。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `accountId` | string | 是 | 账号 ID |

```bash
fuma session qr acct_01
```

### undefined

**取消登录** — 取消进行中的登录

取消当前账号进行中的登录流程并清理二维码状态。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `accountId` | string | 是 | 账号 ID |

```bash
fuma session cancel acct_01
```

### undefined

**登出** — 清除本地会话

清除账号本地 token/会话（不会强制上游下线）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `accountId` | string | 是 | 账号 ID |

```bash
fuma session logout acct_01
```

### undefined

**会话心跳** — 轻量保活探针（personalsettingGet）

调用上游轻量只读接口探测会话有效性；记录延迟与健康状态，session_expired 时标记账号过期。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `accountId` | string | 是 | 账号 ID |

```bash
fuma session heartbeat acct_01
```

### undefined

**客户列表** — 分页/筛选/排序查询客户

客户列表（默认本地缓存优先）。支持 filters（字段_操作符，见文档筛选 DSL）与 systemSelection 预置筛选、分页、排序。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `--account <id>` | string | 否 | 账号 ID（读可路由任意在线账号） |
| `--filters <json>` | json | 否 | 筛选条件 JSON，如 {"seasFlag_eq":0} |
| `--system-selection <json>` | json | 否 | 预置筛选 JSON |
| `--page <n>` | number | 否 | 页码（从 1 开始）（默认 `1`） |
| `--page-size <n>` | number | 否 | 每页条数（默认 20）（默认 `20`） |
| `--sort <field:asc|desc>` | string | 否 | 排序 |
| `--fresh` | boolean | 否 | 强制上游刷新（默认 `false`） |

```bash
fuma customer list --page 1 --page-size 20
```

### undefined

**客户详情** — 单个客户详情与保护状态

客户详情（本地缓存优先，fresh=true 强制上游）：基础信息 + 主联系人 + 归属/保护状态。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `customerId` | string | 是 | 客户 ID（key_id） |
| `--account <id>` | string | 否 | 账号 ID |
| `--fresh` | boolean | 否 | 强制上游（默认 `false`） |

```bash
fuma customer get 873590689807446016
```

### undefined

**客户建档** — 本地优先建档并异步同步上游

客户建档：本地事务写事实 + outbox，立即返回 syncState=pending；异步同步上游。需要 accountId。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `--account <id>` | string | 是 | 账号 ID（写操作必填） |
| `--data <json>` | json | 是 | 客户字段 JSON（custName 等） |
| `--idempotency-key <key>` | string | 否 | 幂等键 |

```bash
fuma customer create --account acct_01 --data '{"custName":"ZZ_TEST_X"}'
```

### undefined

**客户编辑** — 本地优先编辑并异步同步

客户字段级更新：本地先事实 + outbox；冲突最终收敛上游（sync.conflict 事件）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `--account <id>` | string | 是 | 账号 ID（写操作必填） |
| `customerId` | string | 是 | 客户 ID |
| `--data <json>` | json | 是 | 待更新字段 JSON |
| `--idempotency-key <key>` | string | 否 | 幂等键 |

```bash
fuma customer update --account acct_01 873590689807446016 --data '{"remarks":"x"}'
```

### undefined

**客户删除** — 删除（软删进回收站）

删除指定客户（上游软删进回收站），需要 accountId。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `--account <id>` | string | 是 | 账号 ID（写操作必填） |
| `customerId` | string | 是 | 客户 ID |
| `--idempotency-key <key>` | string | 否 | 幂等键 |

```bash
fuma customer delete --account acct_01 873590689807446016
```

### undefined

**公海列表** — 公海客户分页/筛选

公海客户列表（seasFlag=1），支持分页、筛选、预置筛选；本地缓存优先。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `--account <id>` | string | 否 | 账号 ID |
| `--filters <json>` | json | 否 | 筛选条件 JSON |
| `--page <n>` | number | 否 | 页码（默认 `1`） |
| `--page-size <n>` | number | 否 | 每页条数（默认 `20`） |
| `--fresh` | boolean | 否 | 强制上游（默认 `false`） |

```bash
fuma open-sea list --page 1
```

### undefined

**领取公海客户** — 强制查重 + 容量/冷却校验后领取

领取公海客户：强制先查后领（命中→duplicate_customer）；校验容量（按角色规则）、释放冷却（默认 3 天）、公海状态；本地 pending → 上游 doBatchReceive。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `--account <id>` | string | 是 | 账号 ID（写操作必填） |
| `customerId` | string | 是 | 客户 ID |
| `--idempotency-key <key>` | string | 否 | 幂等键（建议 UUID） |

```bash
fuma open-sea claim --account acct_01 873590689807446016 --idempotency-key ...
```

### undefined

**释放客户到公海** — 释放（本地优先 → doPutSeas）

把客户放回公海：本地标记 pending → 上游 doPutSeas/doBatchPutSeas；记录释放时间用于 3 天冷却。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `--account <id>` | string | 是 | 账号 ID（写操作必填） |
| `customerId` | string | 是 | 客户 ID |
| `--reason <text>` | string | 否 | 释放原因 |
| `--idempotency-key <key>` | string | 否 | 幂等键 |

```bash
fuma open-sea release --account acct_01 873590689807446016
```

### undefined

**单条查重** — 按关键词查重（公司/联系人/电话等）

调用上游 repeat/check，返回命中数量；结果落本地快照。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `--account <id>` | string | 否 | 账号 ID |
| `keywords` | string | 是 | 关键词 |
| `--module-code <code>` | string | 否 | 模块（默认 NewBF001）（默认 `"NewBF001"`） |

```bash
fuma dedup check "河北高迪管道设备制造有限公司"
```

### undefined

**批量查重** — 批量查重（任务化，≤200/批）

批量查重任务：分片调用上游，结果逐条落库；返回 taskId 供轮询。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `--account <id>` | string | 否 | 账号 ID |
| `--keywords <json>` | json | 是 | 关键词数组 JSON |
| `--chunk-size <n>` | number | 否 | 分片大小（默认 200）（默认 `200`） |

```bash
fuma dedup batch --keywords '["公司A","公司B"]'
```

### undefined

**查重历史** — 近期查重记录

查询查重历史（上游 getHistory + 本地快照）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `--account <id>` | string | 否 | 账号 ID |
| `--module-code <code>` | string | 否 | 模块（默认 `"NewBF001"`） |
| `--size <n>` | number | 否 | 条数（默认 `5`） |

```bash
fuma dedup history
```

### undefined

**联系人列表** — 按客户查询联系人

联系人列表（客户详情 subBill 方式），支持分页。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `--account <id>` | string | 否 | 账号 ID |
| `--customer <id>` | string | 否 | 客户 ID |
| `--page <n>` | number | 否 | 页码（默认 `1`） |
| `--page-size <n>` | number | 否 | 每页条数（默认 `20`） |

```bash
fuma contact list --customer 873590689807446016
```

### undefined

**新建联系人** — 本地优先创建联系人

为指定客户创建联系人（本地先事实 + outbox → 上游 bill/sub/add_sub）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `--account <id>` | string | 是 | 账号 ID（写操作必填） |
| `--customer <id>` | string | 是 | 客户 ID |
| `--data <json>` | json | 是 | 联系人字段 JSON |

```bash
fuma contact create --account acct_01 --customer <id> --data '{"contName":"张三"}'
```

### undefined

**编辑联系人** — 编辑联系人（本地优先）

编辑联系人字段；本地先事实 + outbox。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `--account <id>` | string | 是 | 账号 ID（写操作必填） |
| `contactId` | string | 是 | 联系人 ID |
| `--data <json>` | json | 是 | 字段 JSON |

```bash
fuma contact update --account acct_01 <id> --data '{"position":"采购"}'
```

### undefined

**跟进列表** — 跟进记录分页/筛选

跟进记录列表（moduleCode=NewBF004），支持按客户/分页/筛选。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `--account <id>` | string | 否 | 账号 ID |
| `--customer <id>` | string | 否 | 客户 ID |
| `--page <n>` | number | 否 | 页码（默认 `1`） |
| `--page-size <n>` | number | 否 | 每页条数（默认 `20`） |

```bash
fuma followup list --customer <id>
```

### undefined

**新建跟进** — 本地优先新建跟进

新建跟进记录（内容/方式/时间/关联联系人）：本地先事实 + outbox → 上游；成功后更新客户保护期相关字段。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `--account <id>` | string | 是 | 账号 ID（写操作必填） |
| `--customer <id>` | string | 是 | 客户 ID |
| `--content <text>` | string | 是 | 跟进内容 |
| `--method <text>` | string | 否 | 跟进方式（如 Call/WeChat） |
| `--followed-at <iso>` | string | 否 | 跟进时间 |
| `--next-at <iso>` | string | 否 | 下次跟进时间 |
| `--contact <id>` | string | 否 | 关联联系人 ID |

```bash
fuma followup create --account acct_01 --customer <id> --content "电话沟通"
```

### undefined

**海关公司查询** — 按公司查询贸易数据（本地缓存）

MVP 仅按公司查询（tradeList 公司维度）。强制本地缓存：命中不发上游请求；支持 forceRefresh/allowStale；权限域隔离。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `--account <id>` | string | 否 | 账号 ID（建议，用于权限校验） |
| `inputCompany` | string | 是 | 公司关键词（≥2 字符） |
| `--company-flag <n>` | number | 否 | 1=进口 2=出口（默认 1）（默认 `1`） |
| `--page <n>` | number | 否 | 页码（默认 `1`） |
| `--page-size <n>` | number | 否 | 每页条数（默认 `20`） |
| `--force-refresh` | boolean | 否 | 跳过缓存强制上游（默认 `false`） |
| `--allow-stale <bool>` | boolean | 否 | 上游失败时允许 stale 缓存（默认 `true`） |

```bash
fuma customs query "Ningbo" --page 1 --page-size 20
```

### undefined

**海关字典** — 国家/HS/数据源字典

返回海关字典：国家列表、HS 编码、数据源导入导出统计、更新日志；本地缓存 TTL 7 天。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `--account <id>` | string | 否 | 账号 ID |
| `--kind <name>` | string | 否 | 字典类型：countries|hscode|sources|updatelog（默认 `"countries"`） |

```bash
fuma customs dictionaries --kind countries
```

### undefined

**海关缓存统计** — 命中率/条目/占用

返回海关本地缓存统计：条目数、字节数、命中率、最近刷新时间。

```bash
fuma customs cache-stats
```

### undefined

**清理海关缓存** — 按条件清理缓存

清理海关本地缓存：可按 queryType/公司关键词/时间范围；默认清全部过期或指定条件。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `--query-type <type>` | string | 否 | 缓存类型（company/dict） |
| `--company <kw>` | string | 否 | 公司关键词过滤 |
| `--before <iso>` | string | 否 | 清理该时间之前的缓存 |

```bash
fuma customs cache-purge --query-type company
```

### undefined

**任务详情** — 任务状态/进度/结果

查询任务状态、进度、结果或错误；支持结果分页读取（task.results）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `taskId` | string | 是 | 任务 ID |

```bash
fuma task get task_abc
```

### undefined

**取消任务** — 取消排队/运行中的任务

取消任务（queued/running），已完成的不能取消。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `taskId` | string | 是 | 任务 ID |

```bash
fuma task cancel task_abc
```

### undefined

**任务列表** — 按状态/类型列出任务

任务列表：支持状态、类型、分页过滤。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `--status <status>` | string | 否 | 状态过滤 |
| `--type <type>` | string | 否 | 类型过滤 |
| `--page <n>` | number | 否 | 页码（默认 `1`） |
| `--page-size <n>` | number | 否 | 每页条数（默认 `20`） |

```bash
fuma task list --status running
```

### undefined

**事件查询** — 按序号轮询事件（sinceSeq）

轮询事件：sinceSeq 之后的事件列表（eventId/seq/type/payload）；消费方按 eventId+seq 幂等。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `--since-seq <n>` | number | 否 | 起始序号（不含）（默认 `0`） |
| `--limit <n>` | number | 否 | 最多条数（默认 `100`） |
| `--type <type>` | string | 否 | 事件类型过滤 |

```bash
fuma event list --since-seq 0
```

### undefined

**同步状态** — outbox/对账状态

同步状态：outbox 队列、失败明细、最近对账时间、差异数。

```bash
fuma sync status
```

### undefined

**触发对账** — 拉取上游增量并收敛

触发对账任务（可选 accountId）：拉取上游事实、diff、收敛到上游、发 sync.conflict 事件。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `--account <id>` | string | 否 | 账号 ID（可选） |
| `--scope <scope>` | string | 否 | 范围：customers|open_sea|followups|capacity（默认 `"customers"`） |

```bash
fuma sync reconcile --scope customers
```

### undefined

**重试 outbox** — 手动重试失败的同步项

手动重试指定的 outbox 项（失败/重试耗尽）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `--outbox-id <n>` | number | 是 | outbox ID |

```bash
fuma sync retry --outbox-id 12
```
