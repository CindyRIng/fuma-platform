# MCP 工具参考

> 版本 1.0.2｜stdio 运行：`fuma mcp`｜共 43 个工具（已实现 42 个）。

| 工具 | 说明 | 阶段 | 已实现 |
|---|---|---|---|
| `fuma_system_health` | 健康检查 | P2 | ✅ |
| `fuma_system_status` | 详细状态 | P2 | ✅ |
| `fuma_system_version` | 版本信息 | P2 | ✅ |
| `fuma_system_capabilities` | 能力清单 | P2 | ✅ |
| `fuma_account_list` | 账号列表 | P2 | ✅ |
| `fuma_account_get` | 账号详情 | P2 | ✅ |
| `fuma_account_create` | 新增账号 | P2 | ✅ |
| `fuma_account_update` | 更新账号 | P2 | ✅ |
| `fuma_account_capacity` | 账号容量 | P2 | ✅ |
| `fuma_session_list` | 会话列表 | P3 | ✅ |
| `fuma_session_status` | 会话状态 | P3 | ✅ |
| `fuma_session_login` | 触发登录 | P3 | ✅ |
| `fuma_session_qr` | 获取二维码 | P3 | ✅ |
| `fuma_session_cancel` | 取消登录 | P3 | ✅ |
| `fuma_session_logout` | 登出 | P3 | ✅ |
| `fuma_session_heartbeat` | 会话心跳 | P3 | ✅ |
| `fuma_customer_list` | 客户列表 | P4 | ✅ |
| `fuma_customer_get` | 客户详情 | P4 | ✅ |
| `fuma_customer_create` | 客户建档 | P5 | ✅ |
| `fuma_customer_update` | 客户编辑 | P5 | ✅ |
| `fuma_customer_delete` | 客户删除 | P5 | ✅ |
| `fuma_open_sea_list` | 公海列表 | P4 | ✅ |
| `fuma_open_sea_claim` | 领取公海客户 | P5 | ✅ |
| `fuma_open_sea_release` | 释放客户到公海 | P5 | ✅ |
| `fuma_dedup_check` | 单条查重 | P4 | ✅ |
| `fuma_dedup_batch` | 批量查重 | P5 | ✅ |
| `fuma_dedup_history` | 查重历史 | P4 | ✅ |
| `fuma_contact_list` | 联系人列表 | P4 | ✅ |
| `fuma_contact_create` | 新建联系人 | P5 | ✅ |
| `fuma_contact_update` | 编辑联系人 | P5 | — |
| `fuma_followup_list` | 跟进列表 | P4 | ✅ |
| `fuma_followup_create` | 新建跟进 | P5 | ✅ |
| `fuma_customs_query` | 海关公司查询 | P4 | ✅ |
| `fuma_customs_dictionaries` | 海关字典 | P4 | ✅ |
| `fuma_customs_cache-stats` | 海关缓存统计 | P4 | ✅ |
| `fuma_customs_cache-purge` | 清理海关缓存 | P4 | ✅ |
| `fuma_task_get` | 任务详情 | P4 | ✅ |
| `fuma_task_cancel` | 取消任务 | P5 | ✅ |
| `fuma_task_list` | 任务列表 | P4 | ✅ |
| `fuma_event_list` | 事件查询 | P5 | ✅ |
| `fuma_sync_status` | 同步状态 | P5 | ✅ |
| `fuma_sync_reconcile` | 触发对账 | P5 | ✅ |
| `fuma_sync_retry` | 重试 outbox | P5 | ✅ |

工具返回值为 JSON envelope 文本（与 REST 一致），失败时 `isError=true`。

## fuma_system_health

返回平台运行状态：版本、spec 版本、运行时长、数据库是否可用、schema 版本、账号总数与在线数。

对应 CLI: fuma system health；对应 REST: GET /v1/health。

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

## fuma_system_status

在健康检查基础上返回账号明细、账号池水位、同步队列与任务统计，用于运维与编排层决策。

对应 CLI: fuma system status；对应 REST: GET /v1/status。

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

## fuma_system_version

返回平台版本、spec 版本、Node 版本与 git 提交（若可用）。

对应 CLI: fuma system version；对应 REST: GET /v1/version。

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

## fuma_system_capabilities

返回能力注册表：id、标题、说明、参数、CLI 命令、REST 路由、MCP 工具名、实现阶段。用于生成文档与集成。

对应 CLI: fuma system capabilities；对应 REST: GET /v1/capabilities。

```json
{
  "type": "object",
  "properties": {
    "category": {
      "type": "string",
      "description": "按分类过滤"
    },
    "implemented": {
      "type": "boolean",
      "description": "仅显示已实现"
    }
  },
  "additionalProperties": false
}
```

## fuma_account_list

返回账号列表：accountId、名称、业务员（不脱敏）、登录方式、状态、容量上限/已用/剩余、来源。

对应 CLI: fuma account list；对应 REST: GET /v1/accounts。

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

## fuma_account_get

返回单个账号详情、会话状态摘要与容量（limit/used/remaining/source）。

对应 CLI: fuma account get；对应 REST: GET /v1/accounts/{accountId}。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID"
    }
  },
  "required": [
    "accountId"
  ],
  "additionalProperties": false
}
```

## fuma_account_create

登记一个账号（仅本地）：账号 ID、名称、业务员、登录方式、钉钉组织、孚盟企业、可选容量覆盖。

对应 CLI: fuma account create；对应 REST: POST /v1/accounts。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID（如 acct_01）"
    },
    "name": {
      "type": "string",
      "description": "显示名称"
    },
    "ownerName": {
      "type": "string",
      "description": "业务员姓名"
    },
    "loginMode": {
      "type": "string",
      "description": "登录方式：dingtalk_sso_qr|password_slider_dingtalk|manual_token"
    },
    "dingtalkOrg": {
      "type": "string",
      "description": "钉钉组织精确名称"
    },
    "fumaEnterprise": {
      "type": "string",
      "description": "孚盟企业精确名称"
    },
    "capacityLimit": {
      "type": "number",
      "description": "容量上限覆盖（默认按规则解析）"
    },
    "keepBrowserAlive": {
      "type": "boolean",
      "description": "该账号登录后是否保持浏览器（默认否）"
    }
  },
  "required": [
    "accountId"
  ],
  "additionalProperties": false
}
```

## fuma_account_update

更新账号名称、业务员、登录方式、组织/企业、容量覆盖、状态、是否保持浏览器。

对应 CLI: fuma account update；对应 REST: PATCH /v1/accounts/{accountId}。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID"
    },
    "name": {
      "type": "string",
      "description": "显示名称"
    },
    "ownerName": {
      "type": "string",
      "description": "业务员姓名"
    },
    "status": {
      "type": "string",
      "description": "状态：inactive|active|degraded|disabled"
    },
    "capacityLimit": {
      "type": "number",
      "description": "容量上限覆盖"
    },
    "keepBrowserAlive": {
      "type": "boolean",
      "description": "是否保持浏览器"
    }
  },
  "required": [
    "accountId"
  ],
  "additionalProperties": false
}
```

## fuma_account_capacity

返回账号客保容量：limit（默认 500，按角色 custLimit 规则解析）、used、remaining、source、lastSyncedAt。

对应 CLI: fuma account capacity；对应 REST: GET /v1/accounts/{accountId}/capacity。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID"
    }
  },
  "required": [
    "accountId"
  ],
  "additionalProperties": false
}
```

## fuma_session_list

返回各账号会话状态机、token 过期时间、健康度与最近错误。

对应 CLI: fuma session list；对应 REST: GET /v1/sessions。

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

## fuma_session_status

返回账号登录状态机当前状态、二维码（如就绪）、token 剩余时间、心跳健康度。

对应 CLI: fuma session status；对应 REST: GET /v1/accounts/{accountId}/session。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID"
    }
  },
  "required": [
    "accountId"
  ],
  "additionalProperties": false
}
```

## fuma_session_login

触发账号登录（默认钉钉扫码）。返回当前状态；登录过程需人工扫码时通过 session qr 获取二维码。

对应 CLI: fuma session login；对应 REST: POST /v1/accounts/{accountId}/session/login。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID"
    },
    "mode": {
      "type": "string",
      "description": "登录方式（可选，默认按账号配置）"
    }
  },
  "required": [
    "accountId"
  ],
  "additionalProperties": false
}
```

## fuma_session_qr

返回钉钉登录二维码：payload、pngBase64、过期时间、刷新次数；CLI 会同时打印终端二维码。

对应 CLI: fuma session qr；对应 REST: GET /v1/accounts/{accountId}/session/qr。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID"
    }
  },
  "required": [
    "accountId"
  ],
  "additionalProperties": false
}
```

## fuma_session_cancel

取消当前账号进行中的登录流程并清理二维码状态。

对应 CLI: fuma session cancel；对应 REST: POST /v1/accounts/{accountId}/session/cancel。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID"
    }
  },
  "required": [
    "accountId"
  ],
  "additionalProperties": false
}
```

## fuma_session_logout

清除账号本地 token/会话（不会强制上游下线）。

对应 CLI: fuma session logout；对应 REST: POST /v1/accounts/{accountId}/session/logout。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID"
    }
  },
  "required": [
    "accountId"
  ],
  "additionalProperties": false
}
```

## fuma_session_heartbeat

调用上游轻量只读接口探测会话有效性；记录延迟与健康状态，session_expired 时标记账号过期。

对应 CLI: fuma session heartbeat；对应 REST: POST /v1/accounts/{accountId}/session/heartbeat。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID"
    }
  },
  "required": [
    "accountId"
  ],
  "additionalProperties": false
}
```

## fuma_customer_list

客户列表（默认本地缓存优先）。支持 filters（字段_操作符，见文档筛选 DSL）与 systemSelection 预置筛选、分页、排序。

对应 CLI: fuma customer list；对应 REST: POST /v1/customers/list。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID（读可路由任意在线账号）"
    },
    "filters": {
      "type": "object",
      "additionalProperties": true,
      "description": "筛选条件 JSON，如 {\"seasFlag_eq\":0}"
    },
    "systemSelection": {
      "type": "object",
      "additionalProperties": true,
      "description": "预置筛选 JSON"
    },
    "page": {
      "type": "number",
      "description": "页码（从 1 开始）"
    },
    "pageSize": {
      "type": "number",
      "description": "每页条数（默认 20）"
    },
    "sort": {
      "type": "string",
      "description": "排序"
    },
    "fresh": {
      "type": "boolean",
      "description": "强制上游刷新"
    }
  },
  "additionalProperties": false
}
```

## fuma_customer_get

客户详情（本地缓存优先，fresh=true 强制上游）：基础信息 + 主联系人 + 归属/保护状态。

对应 CLI: fuma customer get；对应 REST: GET /v1/customers/{customerId}。

```json
{
  "type": "object",
  "properties": {
    "customerId": {
      "type": "string",
      "description": "客户 ID（key_id）"
    },
    "accountId": {
      "type": "string",
      "description": "账号 ID"
    },
    "fresh": {
      "type": "boolean",
      "description": "强制上游"
    }
  },
  "required": [
    "customerId"
  ],
  "additionalProperties": false
}
```

## fuma_customer_create

客户建档：本地事务写事实 + outbox，立即返回 syncState=pending；异步同步上游。需要 accountId。

对应 CLI: fuma customer create；对应 REST: POST /v1/customers。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID（写操作必填）"
    },
    "data": {
      "type": "object",
      "additionalProperties": true,
      "description": "客户字段 JSON（custName 等）"
    },
    "idempotencyKey": {
      "type": "string",
      "description": "幂等键"
    }
  },
  "required": [
    "accountId",
    "data"
  ],
  "additionalProperties": false
}
```

## fuma_customer_update

客户字段级更新：本地先事实 + outbox；冲突最终收敛上游（sync.conflict 事件）。

对应 CLI: fuma customer update；对应 REST: PATCH /v1/customers/{customerId}。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID（写操作必填）"
    },
    "customerId": {
      "type": "string",
      "description": "客户 ID"
    },
    "data": {
      "type": "object",
      "additionalProperties": true,
      "description": "待更新字段 JSON"
    },
    "idempotencyKey": {
      "type": "string",
      "description": "幂等键"
    }
  },
  "required": [
    "accountId",
    "customerId",
    "data"
  ],
  "additionalProperties": false
}
```

## fuma_customer_delete

删除指定客户（上游软删进回收站），需要 accountId。

对应 CLI: fuma customer delete；对应 REST: DELETE /v1/customers/{customerId}。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID（写操作必填）"
    },
    "customerId": {
      "type": "string",
      "description": "客户 ID"
    },
    "idempotencyKey": {
      "type": "string",
      "description": "幂等键"
    }
  },
  "required": [
    "accountId",
    "customerId"
  ],
  "additionalProperties": false
}
```

## fuma_open_sea_list

公海客户列表（seasFlag=1），支持分页、筛选、预置筛选；本地缓存优先。

对应 CLI: fuma open-sea list；对应 REST: POST /v1/open-sea/list。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID"
    },
    "filters": {
      "type": "object",
      "additionalProperties": true,
      "description": "筛选条件 JSON"
    },
    "page": {
      "type": "number",
      "description": "页码"
    },
    "pageSize": {
      "type": "number",
      "description": "每页条数"
    },
    "fresh": {
      "type": "boolean",
      "description": "强制上游"
    }
  },
  "additionalProperties": false
}
```

## fuma_open_sea_claim

领取公海客户：强制先查后领（命中→duplicate_customer）；校验容量（按角色规则）、释放冷却（默认 3 天）、公海状态；本地 pending → 上游 doBatchReceive。

对应 CLI: fuma open-sea claim；对应 REST: POST /v1/open-sea/{customerId}/claim。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID（写操作必填）"
    },
    "customerId": {
      "type": "string",
      "description": "客户 ID"
    },
    "idempotencyKey": {
      "type": "string",
      "description": "幂等键（建议 UUID）"
    }
  },
  "required": [
    "accountId",
    "customerId"
  ],
  "additionalProperties": false
}
```

## fuma_open_sea_release

把客户放回公海：本地标记 pending → 上游 doPutSeas/doBatchPutSeas；记录释放时间用于 3 天冷却。

对应 CLI: fuma open-sea release；对应 REST: POST /v1/open-sea/{customerId}/release。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID（写操作必填）"
    },
    "customerId": {
      "type": "string",
      "description": "客户 ID"
    },
    "reason": {
      "type": "string",
      "description": "释放原因"
    },
    "idempotencyKey": {
      "type": "string",
      "description": "幂等键"
    }
  },
  "required": [
    "accountId",
    "customerId"
  ],
  "additionalProperties": false
}
```

## fuma_dedup_check

调用上游 repeat/check，返回命中数量；结果落本地快照。

对应 CLI: fuma dedup check；对应 REST: POST /v1/dedup/check。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID"
    },
    "keywords": {
      "type": "string",
      "description": "关键词"
    },
    "moduleCode": {
      "type": "string",
      "description": "模块（默认 NewBF001）"
    }
  },
  "required": [
    "keywords"
  ],
  "additionalProperties": false
}
```

## fuma_dedup_batch

批量查重任务：分片调用上游，结果逐条落库；返回 taskId 供轮询。

对应 CLI: fuma dedup batch；对应 REST: POST /v1/dedup/batch。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID"
    },
    "keywords": {
      "type": "object",
      "additionalProperties": true,
      "description": "关键词数组 JSON"
    },
    "chunkSize": {
      "type": "number",
      "description": "分片大小（默认 200）"
    }
  },
  "required": [
    "keywords"
  ],
  "additionalProperties": false
}
```

## fuma_dedup_history

查询查重历史（上游 getHistory + 本地快照）。

对应 CLI: fuma dedup history；对应 REST: GET /v1/dedup/history。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID"
    },
    "moduleCode": {
      "type": "string",
      "description": "模块"
    },
    "size": {
      "type": "number",
      "description": "条数"
    }
  },
  "additionalProperties": false
}
```

## fuma_contact_list

联系人列表（客户详情 subBill 方式），支持分页与 fresh 强制上游。

对应 CLI: fuma contact list；对应 REST: POST /v1/contacts/list。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID"
    },
    "customerId": {
      "type": "string",
      "description": "客户 ID"
    },
    "page": {
      "type": "number",
      "description": "页码"
    },
    "pageSize": {
      "type": "number",
      "description": "每页条数"
    },
    "fresh": {
      "type": "boolean",
      "description": "强制上游刷新"
    }
  },
  "additionalProperties": false
}
```

## fuma_contact_create

为指定客户创建联系人（本地先事实 + outbox → 上游 edit_customer 提交 master.contacts；已实测）。

对应 CLI: fuma contact create；对应 REST: POST /v1/contacts。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID（写操作必填）"
    },
    "customerId": {
      "type": "string",
      "description": "客户 ID"
    },
    "data": {
      "type": "object",
      "additionalProperties": true,
      "description": "联系人字段 JSON"
    }
  },
  "required": [
    "accountId",
    "customerId",
    "data"
  ],
  "additionalProperties": false
}
```

## fuma_contact_update

编辑联系人字段；本地先事实 + outbox。

对应 CLI: fuma contact update；对应 REST: PATCH /v1/contacts/{contactId}。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID（写操作必填）"
    },
    "contactId": {
      "type": "string",
      "description": "联系人 ID"
    },
    "data": {
      "type": "object",
      "additionalProperties": true,
      "description": "字段 JSON"
    }
  },
  "required": [
    "accountId",
    "contactId",
    "data"
  ],
  "additionalProperties": false
}
```

## fuma_followup_list

跟进记录列表（moduleCode=NewBF004），支持按客户/分页/筛选。

对应 CLI: fuma followup list；对应 REST: POST /v1/followups/list。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID"
    },
    "customerId": {
      "type": "string",
      "description": "客户 ID"
    },
    "page": {
      "type": "number",
      "description": "页码"
    },
    "pageSize": {
      "type": "number",
      "description": "每页条数"
    }
  },
  "additionalProperties": false
}
```

## fuma_followup_create

新建跟进记录（内容/方式/时间/关联联系人）：本地先事实 + outbox → 上游；成功后更新客户保护期相关字段。

对应 CLI: fuma followup create；对应 REST: POST /v1/followups。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID（写操作必填）"
    },
    "customerId": {
      "type": "string",
      "description": "客户 ID"
    },
    "content": {
      "type": "string",
      "description": "跟进内容"
    },
    "method": {
      "type": "string",
      "description": "跟进方式（如 Call/WeChat）"
    },
    "followedAt": {
      "type": "string",
      "description": "跟进时间"
    },
    "nextFollowupAt": {
      "type": "string",
      "description": "下次跟进时间"
    },
    "contactId": {
      "type": "string",
      "description": "关联联系人 ID"
    }
  },
  "required": [
    "accountId",
    "customerId",
    "content"
  ],
  "additionalProperties": false
}
```

## fuma_customs_query

MVP 仅按公司查询（tradeList 公司维度）。强制本地缓存：命中不发上游请求；支持 forceRefresh/allowStale；权限域隔离。

对应 CLI: fuma customs query；对应 REST: POST /v1/customs/query。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID（建议，用于权限校验）"
    },
    "inputCompany": {
      "type": "string",
      "description": "公司关键词（≥2 字符）"
    },
    "companyFlag": {
      "type": "number",
      "description": "1=进口 2=出口（默认 1）"
    },
    "page": {
      "type": "number",
      "description": "页码"
    },
    "pageSize": {
      "type": "number",
      "description": "每页条数"
    },
    "forceRefresh": {
      "type": "boolean",
      "description": "跳过缓存强制上游"
    },
    "allowStale": {
      "type": "boolean",
      "description": "上游失败时允许 stale 缓存"
    }
  },
  "required": [
    "inputCompany"
  ],
  "additionalProperties": false
}
```

## fuma_customs_dictionaries

返回海关字典：国家列表、HS 编码、数据源导入导出统计、更新日志；本地缓存 TTL 7 天。

对应 CLI: fuma customs dictionaries；对应 REST: GET /v1/customs/dictionaries。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID"
    },
    "kind": {
      "type": "string",
      "description": "字典类型：countries|hscode|sources|updatelog"
    }
  },
  "additionalProperties": false
}
```

## fuma_customs_cache-stats

返回海关本地缓存统计：条目数、字节数、命中率、最近刷新时间。

对应 CLI: fuma customs cache-stats；对应 REST: GET /v1/customs/cache/stats。

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

## fuma_customs_cache-purge

清理海关本地缓存：可按 queryType/公司关键词/时间范围；默认清全部过期或指定条件。

对应 CLI: fuma customs cache-purge；对应 REST: POST /v1/customs/cache/purge。

```json
{
  "type": "object",
  "properties": {
    "queryType": {
      "type": "string",
      "description": "缓存类型（company/dict）"
    },
    "company": {
      "type": "string",
      "description": "公司关键词过滤"
    },
    "before": {
      "type": "string",
      "description": "清理该时间之前的缓存"
    }
  },
  "additionalProperties": false
}
```

## fuma_task_get

查询任务状态、进度、结果或错误；支持结果分页读取（task.results）。

对应 CLI: fuma task get；对应 REST: GET /v1/tasks/{taskId}。

```json
{
  "type": "object",
  "properties": {
    "taskId": {
      "type": "string",
      "description": "任务 ID"
    }
  },
  "required": [
    "taskId"
  ],
  "additionalProperties": false
}
```

## fuma_task_cancel

取消任务（queued/running），已完成的不能取消。

对应 CLI: fuma task cancel；对应 REST: POST /v1/tasks/{taskId}/cancel。

```json
{
  "type": "object",
  "properties": {
    "taskId": {
      "type": "string",
      "description": "任务 ID"
    }
  },
  "required": [
    "taskId"
  ],
  "additionalProperties": false
}
```

## fuma_task_list

任务列表：支持状态、类型、分页过滤。

对应 CLI: fuma task list；对应 REST: GET /v1/tasks。

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "description": "状态过滤"
    },
    "type": {
      "type": "string",
      "description": "类型过滤"
    },
    "page": {
      "type": "number",
      "description": "页码"
    },
    "pageSize": {
      "type": "number",
      "description": "每页条数"
    }
  },
  "additionalProperties": false
}
```

## fuma_event_list

轮询事件：sinceSeq 之后的事件列表（eventId/seq/type/payload）；消费方按 eventId+seq 幂等。

对应 CLI: fuma event list；对应 REST: GET /v1/events。

```json
{
  "type": "object",
  "properties": {
    "sinceSeq": {
      "type": "number",
      "description": "起始序号（不含）"
    },
    "limit": {
      "type": "number",
      "description": "最多条数"
    },
    "type": {
      "type": "string",
      "description": "事件类型过滤"
    }
  },
  "additionalProperties": false
}
```

## fuma_sync_status

同步状态：outbox 队列、失败明细、最近对账时间、差异数。

对应 CLI: fuma sync status；对应 REST: GET /v1/sync/status。

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

## fuma_sync_reconcile

触发对账任务（可选 accountId）：拉取上游事实、diff、收敛到上游、发 sync.conflict 事件。

对应 CLI: fuma sync reconcile；对应 REST: POST /v1/sync/reconcile。

```json
{
  "type": "object",
  "properties": {
    "accountId": {
      "type": "string",
      "description": "账号 ID（可选）"
    },
    "scope": {
      "type": "string",
      "description": "范围：customers|open_sea|followups|capacity"
    }
  },
  "additionalProperties": false
}
```

## fuma_sync_retry

手动重试指定的 outbox 项（失败/重试耗尽）。

对应 CLI: fuma sync retry；对应 REST: POST /v1/sync/outbox/retry。

```json
{
  "type": "object",
  "properties": {
    "outboxId": {
      "type": "number",
      "description": "outbox ID"
    }
  },
  "required": [
    "outboxId"
  ],
  "additionalProperties": false
}
```
