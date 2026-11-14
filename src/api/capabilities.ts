/**
 * 能力注册表：CLI / REST / MCP / spec / 文档 的唯一来源。
 * 新增能力只需在此登记，并（如需要）在 dispatch.ts 实现 handler。
 */
export type ParamType = 'string' | 'number' | 'boolean' | 'json';

export interface ParamSpec {
  name: string;
  in: 'arg' | 'option';
  flags?: string;
  type: ParamType;
  required?: boolean;
  description: string;
  default?: unknown;
  valueHint?: string;
}

export type Phase = 'P2' | 'P3' | 'P4' | 'P5' | 'P6';

export interface Capability {
  id: string;
  noun: string;
  verb: string;
  title: string;
  summary: string;
  description: string;
  category: string;
  phase: Phase;
  mutating: boolean;
  implemented: boolean;
  params: ParamSpec[];
  example: string;
  http: { method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; path: string };
  mcp: { tool: string; description: string };
}

export interface DispatchContext {
  requestId: string;
  actor: 'cli' | 'rest' | 'mcp' | 'internal';
  apiToken?: string;
}

export type Handler = (rt: import('../services/runtime.js').Runtime, input: Record<string, unknown>, ctx: DispatchContext) => Promise<unknown>;

const arg = (name: string, type: ParamType, description: string, required = false): ParamSpec => ({ name, in: 'arg', type, required, description });
const opt = (name: string, flags: string, type: ParamType, description: string, required = false, defaultValue?: unknown): ParamSpec => ({
  name, in: 'option', flags, type, required, description, default: defaultValue
});

const commonAccount = opt('accountId', '--account <id>', 'string', '账号 ID（写操作必填）', true);

function cap(c: Omit<Capability, 'mcp' | 'example'> & { tool?: string; example?: string }): Capability {
  const tool = c.tool ?? `fuma_${c.noun.replaceAll('-', '_')}_${c.verb}`;
  return {
    ...c,
    mcp: { tool, description: c.summary },
    example: c.example ?? `fuma ${c.noun} ${c.verb}`
  };
}

export const CAPABILITIES: Capability[] = [
  // ---------- system ----------
  cap({
    id: 'system.health', noun: 'system', verb: 'health', title: '健康检查', summary: '服务/数据库/账号在线状态',
    description: '返回平台运行状态：版本、spec 版本、运行时长、数据库是否可用、schema 版本、账号总数与在线数。',
    category: 'system', phase: 'P2', mutating: false, implemented: true, params: [],
    http: { method: 'GET', path: '/v1/health' }, example: 'fuma system health'
  }),
  cap({
    id: 'system.status', noun: 'system', verb: 'status', title: '详细状态', summary: '账号/池/同步/任务概览',
    description: '在健康检查基础上返回账号明细、账号池水位、同步队列与任务统计，用于运维与编排层决策。',
    category: 'system', phase: 'P2', mutating: false, implemented: true, params: [],
    http: { method: 'GET', path: '/v1/status' }, example: 'fuma system status'
  }),
  cap({
    id: 'system.version', noun: 'system', verb: 'version', title: '版本信息', summary: '平台版本与 spec 版本',
    description: '返回平台版本、spec 版本、Node 版本与 git 提交（若可用）。',
    category: 'system', phase: 'P2', mutating: false, implemented: true, params: [],
    http: { method: 'GET', path: '/v1/version' }, example: 'fuma system version'
  }),
  cap({
    id: 'system.capabilities', noun: 'system', verb: 'capabilities', title: '能力清单', summary: '列出全部能力（CLI/REST/MCP 映射）',
    description: '返回能力注册表：id、标题、说明、参数、CLI 命令、REST 路由、MCP 工具名、实现阶段。用于生成文档与集成。',
    category: 'system', phase: 'P2', mutating: false, implemented: true,
    params: [opt('category', '--category <name>', 'string', '按分类过滤', false), opt('implemented', '--implemented', 'boolean', '仅显示已实现', false)],
    http: { method: 'GET', path: '/v1/capabilities' }, example: 'fuma system capabilities'
  }),

  // ---------- account ----------
  cap({
    id: 'account.list', noun: 'account', verb: 'list', title: '账号列表', summary: '列出全部账号与容量',
    description: '返回账号列表：accountId、名称、业务员（不脱敏）、登录方式、状态、容量上限/已用/剩余、来源。',
    category: 'account', phase: 'P2', mutating: false, implemented: true, params: [],
    http: { method: 'GET', path: '/v1/accounts' }, example: 'fuma account list'
  }),
  cap({
    id: 'account.get', noun: 'account', verb: 'get', title: '账号详情', summary: '按 ID 查询账号与容量',
    description: '返回单个账号详情、会话状态摘要与容量（limit/used/remaining/source）。',
    category: 'account', phase: 'P2', mutating: false, implemented: true,
    params: [arg('accountId', 'string', '账号 ID', true)],
    http: { method: 'GET', path: '/v1/accounts/{accountId}' }, example: 'fuma account get acct_01'
  }),
  cap({
    id: 'account.create', noun: 'account', verb: 'create', title: '新增账号', summary: '登记账号（登录需另行触发）',
    description: '登记一个账号（仅本地）：账号 ID、名称、业务员、登录方式、钉钉组织、孚盟企业、可选容量覆盖。',
    category: 'account', phase: 'P2', mutating: true, implemented: true,
    params: [
      arg('accountId', 'string', '账号 ID（如 acct_01）', true),
      opt('name', '--name <name>', 'string', '显示名称', false, ''),
      opt('ownerName', '--owner-name <name>', 'string', '业务员姓名'),
      opt('ownerCtId', '--owner-ct-id <id>', 'string', '孚盟账号 ctId（用于容量统计）'),
      opt('loginMode', '--login-mode <mode>', 'string', '登录方式：dingtalk_sso_qr|password_slider_dingtalk|manual_token', false, 'dingtalk_sso_qr'),
      opt('dingtalkOrg', '--dingtalk-org <name>', 'string', '钉钉组织精确名称'),
      opt('fumaEnterprise', '--fuma-enterprise <name>', 'string', '孚盟企业精确名称'),
      opt('capacityLimit', '--capacity-limit <n>', 'number', '容量上限覆盖（默认按规则解析）'),
      opt('keepBrowserAlive', '--keep-browser-alive', 'boolean', '该账号登录后是否保持浏览器（默认否）', false, false)
    ],
    http: { method: 'POST', path: '/v1/accounts' }, example: 'fuma account create acct_01 --name "账号1"'
  }),
  cap({
    id: 'account.update', noun: 'account', verb: 'update', title: '更新账号', summary: '更新账号属性/状态',
    description: '更新账号名称、业务员、登录方式、组织/企业、容量覆盖、状态、是否保持浏览器。',
    category: 'account', phase: 'P2', mutating: true, implemented: true,
    params: [
      arg('accountId', 'string', '账号 ID', true),
      opt('name', '--name <name>', 'string', '显示名称'),
      opt('ownerName', '--owner-name <name>', 'string', '业务员姓名'),
      opt('ownerCtId', '--owner-ct-id <id>', 'string', '孚盟账号 ctId'),
      opt('dingtalkOrg', '--dingtalk-org <name>', 'string', '钉钉组织精确名称'),
      opt('fumaEnterprise', '--fuma-enterprise <name>', 'string', '孚盟企业精确名称'),
      opt('status', '--status <status>', 'string', '状态：inactive|active|degraded|disabled'),
      opt('capacityLimit', '--capacity-limit <n>', 'number', '容量上限覆盖'),
      opt('keepBrowserAlive', '--keep-browser-alive <bool>', 'boolean', '是否保持浏览器')
    ],
    http: { method: 'PATCH', path: '/v1/accounts/{accountId}' }, example: 'fuma account update acct_01 --status active'
  }),
  cap({
    id: 'account.capacity', noun: 'account', verb: 'capacity', title: '账号容量', summary: '容量上限/已用/剩余/来源',
    description: '返回账号客保容量：limit（默认 500，按角色 custLimit 规则解析）、used、remaining、source、lastSyncedAt。',
    category: 'account', phase: 'P2', mutating: false, implemented: true,
    params: [arg('accountId', 'string', '账号 ID', true)],
    http: { method: 'GET', path: '/v1/accounts/{accountId}/capacity' }, example: 'fuma account capacity acct_01'
  }),

  // ---------- session (P3) ----------
  cap({
    id: 'session.list', noun: 'session', verb: 'list', title: '会话列表', summary: '全部账号会话状态',
    description: '返回各账号会话状态机、token 过期时间、健康度与最近错误。',
    category: 'session', phase: 'P3', mutating: false, implemented: true, params: [],
    http: { method: 'GET', path: '/v1/sessions' }, example: 'fuma session list'
  }),
  cap({
    id: 'session.status', noun: 'session', verb: 'status', title: '会话状态', summary: '单账号会话状态',
    description: '返回账号登录状态机当前状态、二维码（如就绪）、token 剩余时间、心跳健康度。',
    category: 'session', phase: 'P3', mutating: false, implemented: true,
    params: [arg('accountId', 'string', '账号 ID', true)],
    http: { method: 'GET', path: '/v1/accounts/{accountId}/session' }, example: 'fuma session status acct_01'
  }),
  cap({
    id: 'session.login', noun: 'session', verb: 'login', title: '触发登录', summary: '发起扫码/账密登录',
    description: '触发账号登录（默认钉钉扫码）。返回当前状态；登录过程需人工扫码时通过 session qr 获取二维码。',
    category: 'session', phase: 'P3', mutating: false, implemented: true,
    params: [
      arg('accountId', 'string', '账号 ID', true),
      opt('mode', '--mode <mode>', 'string', '登录方式（可选，默认按账号配置）')
    ],
    http: { method: 'POST', path: '/v1/accounts/{accountId}/session/login' }, example: 'fuma session login acct_01'
  }),
  cap({
    id: 'session.qr', noun: 'session', verb: 'qr', title: '获取二维码', summary: '解码重编码后的登录二维码',
    description: '返回钉钉登录二维码：payload、pngBase64、过期时间、刷新次数；CLI 会同时打印终端二维码。',
    category: 'session', phase: 'P3', mutating: false, implemented: true,
    params: [arg('accountId', 'string', '账号 ID', true)],
    http: { method: 'GET', path: '/v1/accounts/{accountId}/session/qr' }, example: 'fuma session qr acct_01'
  }),
  cap({
    id: 'session.cancel', noun: 'session', verb: 'cancel', title: '取消登录', summary: '取消进行中的登录',
    description: '取消当前账号进行中的登录流程并清理二维码状态。',
    category: 'session', phase: 'P3', mutating: false, implemented: true,
    params: [arg('accountId', 'string', '账号 ID', true)],
    http: { method: 'POST', path: '/v1/accounts/{accountId}/session/cancel' }, example: 'fuma session cancel acct_01'
  }),
  cap({
    id: 'session.logout', noun: 'session', verb: 'logout', title: '登出', summary: '清除本地会话',
    description: '清除账号本地 token/会话（不会强制上游下线）。',
    category: 'session', phase: 'P3', mutating: true, implemented: true,
    params: [arg('accountId', 'string', '账号 ID', true)],
    http: { method: 'POST', path: '/v1/accounts/{accountId}/session/logout' }, example: 'fuma session logout acct_01'
  }),

    cap({
    id: 'session.heartbeat', noun: 'session', verb: 'heartbeat', title: '会话心跳', summary: '轻量保活探针（personalsettingGet）',
    description: '调用上游轻量只读接口探测会话有效性；记录延迟与健康状态，session_expired 时标记账号过期。',
    category: 'session', phase: 'P3', mutating: false, implemented: true,
    params: [arg('accountId', 'string', '账号 ID', true)],
    http: { method: 'POST', path: '/v1/accounts/{accountId}/session/heartbeat' }, example: 'fuma session heartbeat acct_01'
  }),

// ---------- customer (P4) ----------
  cap({
    id: 'customer.list', noun: 'customer', verb: 'list', title: '客户列表', summary: '分页/筛选/排序查询客户',
    description: '客户列表（默认本地缓存优先）。支持 filters（字段_操作符，见文档筛选 DSL）与 systemSelection 预置筛选、分页、排序。',
    category: 'customer', phase: 'P4', mutating: false, implemented: true,
    params: [
      opt('accountId', '--account <id>', 'string', '账号 ID（读可路由任意在线账号）'),
      opt('filters', '--filters <json>', 'json', '筛选条件 JSON，如 {"seasFlag_eq":0}'),
      opt('systemSelection', '--system-selection <json>', 'json', '预置筛选 JSON'),
      opt('page', '--page <n>', 'number', '页码（从 1 开始）', false, 1),
      opt('pageSize', '--page-size <n>', 'number', '每页条数（默认 20）', false, 20),
      opt('sort', '--sort <field:asc|desc>', 'string', '排序'),
      opt('fresh', '--fresh', 'boolean', '强制上游刷新', false, false)
    ],
    http: { method: 'POST', path: '/v1/customers/list' }, example: 'fuma customer list --page 1 --page-size 20'
  }),
  cap({
    id: 'customer.get', noun: 'customer', verb: 'get', title: '客户详情', summary: '单个客户详情与保护状态',
    description: '客户详情（本地缓存优先，fresh=true 强制上游）：基础信息 + 主联系人 + 归属/保护状态。',
    category: 'customer', phase: 'P4', mutating: false, implemented: true,
    params: [arg('customerId', 'string', '客户 ID（key_id）', true), opt('accountId', '--account <id>', 'string', '账号 ID'), opt('fresh', '--fresh', 'boolean', '强制上游', false, false)],
    http: { method: 'GET', path: '/v1/customers/{customerId}' }, example: 'fuma customer get 873590689807446016'
  }),
  cap({
    id: 'customer.create', noun: 'customer', verb: 'create', title: '客户建档', summary: '本地优先建档并异步同步上游',
    description: '客户建档：本地事务写事实 + outbox，立即返回 syncState=pending；异步同步上游。需要 accountId。',
    category: 'customer', phase: 'P5', mutating: true, implemented: true,
    params: [commonAccount, opt('data', '--data <json>', 'json', '客户字段 JSON（custName 等）', true), opt('idempotencyKey', '--idempotency-key <key>', 'string', '幂等键')],
    http: { method: 'POST', path: '/v1/customers' }, example: 'fuma customer create --account acct_01 --data \'{"custName":"ZZ_TEST_X"}\''
  }),
  cap({
    id: 'customer.update', noun: 'customer', verb: 'update', title: '客户编辑', summary: '本地优先编辑并异步同步',
    description: '客户字段级更新：本地先事实 + outbox；冲突最终收敛上游（sync.conflict 事件）。',
    category: 'customer', phase: 'P5', mutating: true, implemented: true,
    params: [commonAccount, arg('customerId', 'string', '客户 ID', true), opt('data', '--data <json>', 'json', '待更新字段 JSON', true), opt('idempotencyKey', '--idempotency-key <key>', 'string', '幂等键')],
    http: { method: 'PATCH', path: '/v1/customers/{customerId}' }, example: 'fuma customer update --account acct_01 873590689807446016 --data \'{"remarks":"x"}\''
  }),
  cap({
    id: 'customer.delete', noun: 'customer', verb: 'delete', title: '客户删除', summary: '删除（软删进回收站）',
    description: '删除指定客户（上游软删进回收站），需要 accountId。',
    category: 'customer', phase: 'P5', mutating: true, implemented: true,
    params: [commonAccount, arg('customerId', 'string', '客户 ID', true), opt('idempotencyKey', '--idempotency-key <key>', 'string', '幂等键')],
    http: { method: 'DELETE', path: '/v1/customers/{customerId}' }, example: 'fuma customer delete --account acct_01 873590689807446016'
  }),

  // ---------- open sea (P4/P5) ----------
  cap({
    id: 'open_sea.list', noun: 'open-sea', verb: 'list', title: '公海列表', summary: '公海客户分页/筛选',
    description: '公海客户列表（seasFlag=1），支持分页、筛选、预置筛选；本地缓存优先。',
    category: 'open_sea', phase: 'P4', mutating: false, implemented: true,
    params: [opt('accountId', '--account <id>', 'string', '账号 ID'), opt('filters', '--filters <json>', 'json', '筛选条件 JSON'), opt('page', '--page <n>', 'number', '页码', false, 1), opt('pageSize', '--page-size <n>', 'number', '每页条数', false, 20), opt('fresh', '--fresh', 'boolean', '强制上游', false, false)],
    http: { method: 'POST', path: '/v1/open-sea/list' }, example: 'fuma open-sea list --page 1'
  }),
  cap({
    id: 'open_sea.claim', noun: 'open-sea', verb: 'claim', title: '领取公海客户', summary: '强制查重 + 容量/冷却校验后领取',
    description: '领取公海客户：强制先查后领（命中→duplicate_customer）；校验容量（按角色规则）、释放冷却（默认 3 天）、公海状态；本地 pending → 上游 doBatchReceive。',
    category: 'open_sea', phase: 'P5', mutating: true, implemented: true,
    params: [commonAccount, arg('customerId', 'string', '客户 ID', true), opt('idempotencyKey', '--idempotency-key <key>', 'string', '幂等键（建议 UUID）')],
    http: { method: 'POST', path: '/v1/open-sea/{customerId}/claim' }, example: 'fuma open-sea claim --account acct_01 873590689807446016 --idempotency-key ...'
  }),
  cap({
    id: 'open_sea.release', noun: 'open-sea', verb: 'release', title: '释放客户到公海', summary: '释放（本地优先 → doPutSeas）',
    description: '把客户放回公海：本地标记 pending → 上游 doPutSeas/doBatchPutSeas；记录释放时间用于 3 天冷却。',
    category: 'open_sea', phase: 'P5', mutating: true, implemented: true,
    params: [commonAccount, arg('customerId', 'string', '客户 ID', true), opt('reason', '--reason <text>', 'string', '释放原因'), opt('idempotencyKey', '--idempotency-key <key>', 'string', '幂等键')],
    http: { method: 'POST', path: '/v1/open-sea/{customerId}/release' }, example: 'fuma open-sea release --account acct_01 873590689807446016'
  }),

  // ---------- dedup (P4) ----------
  cap({
    id: 'dedup.check', noun: 'dedup', verb: 'check', title: '单条查重', summary: '按关键词查重（公司/联系人/电话等）',
    description: '调用上游 repeat/check，返回命中数量；结果落本地快照。',
    category: 'dedup', phase: 'P4', mutating: false, implemented: true,
    params: [opt('accountId', '--account <id>', 'string', '账号 ID'), arg('keywords', 'string', '关键词', true), opt('moduleCode', '--module-code <code>', 'string', '模块（默认 NewBF001）', false, 'NewBF001')],
    http: { method: 'POST', path: '/v1/dedup/check' }, example: 'fuma dedup check "河北高迪管道设备制造有限公司"'
  }),
  cap({
    id: 'dedup.batch', noun: 'dedup', verb: 'batch', title: '批量查重', summary: '批量查重（任务化，≤200/批）',
    description: '批量查重任务：分片调用上游，结果逐条落库；返回 taskId 供轮询。',
    category: 'dedup', phase: 'P5', mutating: false, implemented: true,
    params: [opt('accountId', '--account <id>', 'string', '账号 ID'), opt('keywords', '--keywords <json>', 'json', '关键词数组 JSON', true), opt('chunkSize', '--chunk-size <n>', 'number', '分片大小（默认 200）', false, 200)],
    http: { method: 'POST', path: '/v1/dedup/batch' }, example: 'fuma dedup batch --keywords \'["公司A","公司B"]\''
  }),
  cap({
    id: 'dedup.history', noun: 'dedup', verb: 'history', title: '查重历史', summary: '近期查重记录',
    description: '查询查重历史（上游 getHistory + 本地快照）。',
    category: 'dedup', phase: 'P4', mutating: false, implemented: true,
    params: [opt('accountId', '--account <id>', 'string', '账号 ID'), opt('moduleCode', '--module-code <code>', 'string', '模块', false, 'NewBF001'), opt('size', '--size <n>', 'number', '条数', false, 5)],
    http: { method: 'GET', path: '/v1/dedup/history' }, example: 'fuma dedup history'
  }),

  // ---------- contact / followup (P4/P5) ----------
  cap({
    id: 'contact.list', noun: 'contact', verb: 'list', title: '联系人列表', summary: '按客户查询联系人',
    description: '联系人列表（客户详情 subBill 方式），支持分页与 fresh 强制上游。',
    category: 'contact', phase: 'P4', mutating: false, implemented: true,
    params: [opt('accountId', '--account <id>', 'string', '账号 ID'), opt('customerId', '--customer <id>', 'string', '客户 ID'), opt('page', '--page <n>', 'number', '页码', false, 1), opt('pageSize', '--page-size <n>', 'number', '每页条数', false, 20), opt('fresh', '--fresh', 'boolean', '强制上游刷新', false, false)],
    http: { method: 'POST', path: '/v1/contacts/list' }, example: 'fuma contact list --customer 873590689807446016'
  }),
  cap({
    id: 'contact.create', noun: 'contact', verb: 'create', title: '新建联系人', summary: '本地优先创建联系人',
    description: '为指定客户创建联系人（本地先事实 + outbox → 上游 edit_customer 提交 master.contacts；已实测）。',
    category: 'contact', phase: 'P5', mutating: true, implemented: true,
    params: [commonAccount, opt('customerId', '--customer <id>', 'string', '客户 ID', true), opt('data', '--data <json>', 'json', '联系人字段 JSON', true)],
    http: { method: 'POST', path: '/v1/contacts' }, example: 'fuma contact create --account acct_01 --customer <id> --data \'{"contName":"张三"}\''
  }),
  cap({
    id: 'contact.update', noun: 'contact', verb: 'update', title: '编辑联系人', summary: '编辑联系人（本地优先）',
    description: '编辑联系人字段；本地先事实 + outbox。',
    category: 'contact', phase: 'P5', mutating: true, implemented: false,
    params: [commonAccount, arg('contactId', 'string', '联系人 ID', true), opt('data', '--data <json>', 'json', '字段 JSON', true)],
    http: { method: 'PATCH', path: '/v1/contacts/{contactId}' }, example: 'fuma contact update --account acct_01 <id> --data \'{"position":"采购"}\''
  }),
  cap({
    id: 'followup.list', noun: 'followup', verb: 'list', title: '跟进列表', summary: '跟进记录分页/筛选',
    description: '跟进记录列表（moduleCode=NewBF004），支持按客户/分页/筛选。',
    category: 'followup', phase: 'P4', mutating: false, implemented: true,
    params: [opt('accountId', '--account <id>', 'string', '账号 ID'), opt('customerId', '--customer <id>', 'string', '客户 ID'), opt('page', '--page <n>', 'number', '页码', false, 1), opt('pageSize', '--page-size <n>', 'number', '每页条数', false, 20)],
    http: { method: 'POST', path: '/v1/followups/list' }, example: 'fuma followup list --customer <id>'
  }),
  cap({
    id: 'followup.create', noun: 'followup', verb: 'create', title: '新建跟进', summary: '本地优先新建跟进',
    description: '新建跟进记录（内容/方式/时间/关联联系人）：本地先事实 + outbox → 上游；成功后更新客户保护期相关字段。',
    category: 'followup', phase: 'P5', mutating: true, implemented: true,
    params: [commonAccount, opt('customerId', '--customer <id>', 'string', '客户 ID', true), opt('content', '--content <text>', 'string', '跟进内容', true), opt('method', '--method <text>', 'string', '跟进方式（如 Call/WeChat）'), opt('followedAt', '--followed-at <iso>', 'string', '跟进时间'), opt('nextFollowupAt', '--next-at <iso>', 'string', '下次跟进时间'), opt('contactId', '--contact <id>', 'string', '关联联系人 ID')],
    http: { method: 'POST', path: '/v1/followups' }, example: 'fuma followup create --account acct_01 --customer <id> --content "电话沟通"'
  }),

  // ---------- customs (P4) ----------
  cap({
    id: 'customs.query', noun: 'customs', verb: 'query', title: '海关公司查询', summary: '按公司查询贸易数据（本地缓存）',
    description: 'MVP 仅按公司查询（tradeList 公司维度）。强制本地缓存：命中不发上游请求；支持 forceRefresh/allowStale；权限域隔离。',
    category: 'customs', phase: 'P4', mutating: false, implemented: true,
    params: [opt('accountId', '--account <id>', 'string', '账号 ID（建议，用于权限校验）'), arg('inputCompany', 'string', '公司关键词（≥2 字符）', true), opt('companyFlag', '--company-flag <n>', 'number', '1=进口 2=出口（默认 1）', false, 1), opt('page', '--page <n>', 'number', '页码', false, 1), opt('pageSize', '--page-size <n>', 'number', '每页条数', false, 20), opt('forceRefresh', '--force-refresh', 'boolean', '跳过缓存强制上游', false, false), opt('allowStale', '--allow-stale <bool>', 'boolean', '上游失败时允许 stale 缓存', false, true)],
    http: { method: 'POST', path: '/v1/customs/query' }, example: 'fuma customs query "Ningbo" --page 1 --page-size 20'
  }),
  cap({
    id: 'customs.dictionaries', noun: 'customs', verb: 'dictionaries', title: '海关字典', summary: '国家/HS/数据源字典',
    description: '返回海关字典：国家列表、HS 编码、数据源导入导出统计、更新日志；本地缓存 TTL 7 天。',
    category: 'customs', phase: 'P4', mutating: false, implemented: true,
    params: [opt('accountId', '--account <id>', 'string', '账号 ID'), opt('kind', '--kind <name>', 'string', '字典类型：countries|hscode|sources|updatelog', false, 'countries')],
    http: { method: 'GET', path: '/v1/customs/dictionaries' }, example: 'fuma customs dictionaries --kind countries'
  }),
  cap({
    id: 'customs.cache.stats', noun: 'customs', verb: 'cache-stats', title: '海关缓存统计', summary: '命中率/条目/占用',
    description: '返回海关本地缓存统计：条目数、字节数、命中率、最近刷新时间。',
    category: 'customs', phase: 'P4', mutating: false, implemented: true, params: [],
    http: { method: 'GET', path: '/v1/customs/cache/stats' }, example: 'fuma customs cache-stats'
  }),
  cap({
    id: 'customs.cache.purge', noun: 'customs', verb: 'cache-purge', title: '清理海关缓存', summary: '按条件清理缓存',
    description: '清理海关本地缓存：可按 queryType/公司关键词/时间范围；默认清全部过期或指定条件。',
    category: 'customs', phase: 'P4', mutating: true, implemented: true,
    params: [opt('queryType', '--query-type <type>', 'string', '缓存类型（company/dict）'), opt('company', '--company <kw>', 'string', '公司关键词过滤'), opt('before', '--before <iso>', 'string', '清理该时间之前的缓存')],
    http: { method: 'POST', path: '/v1/customs/cache/purge' }, example: 'fuma customs cache-purge --query-type company'
  }),

  // ---------- task / event / sync (P4/P5) ----------
  cap({
    id: 'task.get', noun: 'task', verb: 'get', title: '任务详情', summary: '任务状态/进度/结果',
    description: '查询任务状态、进度、结果或错误；支持结果分页读取（task.results）。',
    category: 'task', phase: 'P4', mutating: false, implemented: true,
    params: [arg('taskId', 'string', '任务 ID', true)],
    http: { method: 'GET', path: '/v1/tasks/{taskId}' }, example: 'fuma task get task_abc'
  }),
  cap({
    id: 'task.cancel', noun: 'task', verb: 'cancel', title: '取消任务', summary: '取消排队/运行中的任务',
    description: '取消任务（queued/running），已完成的不能取消。',
    category: 'task', phase: 'P5', mutating: true, implemented: true,
    params: [arg('taskId', 'string', '任务 ID', true)],
    http: { method: 'POST', path: '/v1/tasks/{taskId}/cancel' }, example: 'fuma task cancel task_abc'
  }),
  cap({
    id: 'task.list', noun: 'task', verb: 'list', title: '任务列表', summary: '按状态/类型列出任务',
    description: '任务列表：支持状态、类型、分页过滤。',
    category: 'task', phase: 'P4', mutating: false, implemented: true,
    params: [opt('status', '--status <status>', 'string', '状态过滤'), opt('type', '--type <type>', 'string', '类型过滤'), opt('page', '--page <n>', 'number', '页码', false, 1), opt('pageSize', '--page-size <n>', 'number', '每页条数', false, 20)],
    http: { method: 'GET', path: '/v1/tasks' }, example: 'fuma task list --status running'
  }),
  cap({
    id: 'event.list', noun: 'event', verb: 'list', title: '事件查询', summary: '按序号轮询事件（sinceSeq）',
    description: '轮询事件：sinceSeq 之后的事件列表（eventId/seq/type/payload）；消费方按 eventId+seq 幂等。',
    category: 'event', phase: 'P5', mutating: false, implemented: true,
    params: [opt('sinceSeq', '--since-seq <n>', 'number', '起始序号（不含）', false, 0), opt('limit', '--limit <n>', 'number', '最多条数', false, 100), opt('type', '--type <type>', 'string', '事件类型过滤')],
    http: { method: 'GET', path: '/v1/events' }, example: 'fuma event list --since-seq 0'
  }),
  cap({
    id: 'event.purge', noun: 'event', verb: 'purge', title: '事件归档/清理', summary: '按类型与时间归档并删除历史事件',
    description: '归档/清理历史事件：默认删除 30 天前事件；可按类型过滤、先写 JSONL 归档、dryRun 预览。',
    category: 'event', phase: 'P6', mutating: true, implemented: true,
    params: [opt('olderThanDays', '--older-than-days <n>', 'number', '删除早于 N 天的事件（0=删除全部早于当前时刻）', false, 30), opt('before', '--before <iso>', 'string', '绝对截止时间 ISO（优先于 olderThanDays）'), opt('types', '--types <csv>', 'string', '事件类型过滤，逗号分隔，如 sync.conflict'), opt('archive', '--archive <file>', 'string', '归档 JSONL 路径（删除前写入）'), opt('dryRun', '--dry-run', 'boolean', '只统计不删除', false, false)],
    http: { method: 'POST', path: '/v1/events/purge' }, example: 'fuma event purge --types sync.conflict --older-than-days 0 --archive ~/.fuma-platform/backups/events.jsonl'
  }),
  cap({
    id: 'sync.status', noun: 'sync', verb: 'status', title: '同步状态', summary: 'outbox/对账状态',
    description: '同步状态：outbox 队列、失败明细、最近对账时间、差异数。',
    category: 'sync', phase: 'P5', mutating: false, implemented: true, params: [],
    http: { method: 'GET', path: '/v1/sync/status' }, example: 'fuma sync status'
  }),
  cap({
    id: 'sync.reconcile', noun: 'sync', verb: 'reconcile', title: '触发对账', summary: '拉取上游增量并收敛',
    description: '触发对账任务（可选 accountId）：拉取上游事实、diff、收敛到上游、发 sync.conflict 事件。',
    category: 'sync', phase: 'P5', mutating: true, implemented: true,
    params: [opt('accountId', '--account <id>', 'string', '账号 ID（可选）'), opt('scope', '--scope <scope>', 'string', '范围：customers|open_sea|followups|capacity', false, 'customers')],
    http: { method: 'POST', path: '/v1/sync/reconcile' }, example: 'fuma sync reconcile --scope customers'
  }),
  cap({
    id: 'sync.retry', noun: 'sync', verb: 'retry', title: '重试 outbox', summary: '手动重试失败的同步项',
    description: '手动重试指定的 outbox 项（失败/重试耗尽）。',
    category: 'sync', phase: 'P5', mutating: true, implemented: true,
    params: [opt('outboxId', '--outbox-id <n>', 'number', 'outbox ID', true)],
    http: { method: 'POST', path: '/v1/sync/outbox/retry' }, example: 'fuma sync retry --outbox-id 12'
  })
];

export function getCapability(id: string): Capability | undefined {
  return CAPABILITIES.find((c) => c.id === id);
}

export function capabilitiesByNoun(): Map<string, Capability[]> {
  const map = new Map<string, Capability[]>();
  for (const c of CAPABILITIES) {
    const list = map.get(c.noun) ?? [];
    list.push(c);
    map.set(c.noun, list);
  }
  return map;
}

export function cliCommandOf(c: Capability): string {
  return `fuma ${c.noun} ${c.verb}`;
}

export function capabilityToOpenApiPath(c: Capability): string {
  return c.http.path;
}
