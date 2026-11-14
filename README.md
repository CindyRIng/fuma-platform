# fuma-platform

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A522.5-brightgreen)

**孚盟（fumamx.com）本地封装平台**：多账号会话池 + 请求池 + 本地事实库 + 本地缓存 + 事件总线，暴露 **CLI / REST / MCP / SKILL** 四种入口。

> 定位：不是业务编排层（编排在 lead platform），而是孚盟侧的**薄封装**：
> 只封装「客户管理（客保：客户/公海/查重/联系人/跟进）」与「海关数据（按公司查询）」，
> 提供本地事实、规则不变式与同步能力，供上层编排系统调用与订阅。

## 特性

- **多账号会话池**：3–50 个真实业务员账号；每账号独立 profile/token/限速/容量。
- **快速登录 + 长保活**：钉钉 SSO 扫码（二维码 ZXing 解码→自研重编码）；HTTP 心跳保活；到期自动重登；支持免扫码重登实验开关。
- **请求池**：账号级串行、QPS 限速 + 抖动、重试、路由（读可任选在线账号，写必须显式指定账号）。
- **只读能力**：客户列表/详情、公海列表、查重、联系人、跟进、海关按公司查询、字典。
- **海关本地缓存**：强制缓存、TTL、上游更新日志失效、权限域隔离、LRU 容量、缓存统计/清理。
- **写能力（本地优先）**：领取（强制先查后领）、释放、建档、编辑、删除、跟进、联系人；本地事务写事实 + outbox，异步同步上游；冲突收敛上游。
- **规则引擎**：容量（默认 500，按角色规则解析）、15 天保护期、3 天释放冷却、查重强制。
- **事件**：本地事务内 outbox 事件，轮询消费（webhook 预留）。
- **任务**：批量查重任务化（taskId/进度/结果/取消）。

## 快速开始

```bash
# 安装（依赖 + 构建 + 初始化 + systemd user service）
git clone https://github.com/CindyRIng/fuma-platform.git && cd fuma-platform
./scripts/install.sh

# 创建账号（扫码登录前）
fuma account create acct_01 --name "业务员A" --owner-name "业务员A"

# 扫码登录（终端显示二维码）
fuma session login acct_01

# 查询/写入
fuma customer list --page-size 5
fuma dedup check "某公司名称"
fuma customs query "Ningbo" --page-size 5
fuma open-sea claim --account acct_01 <customerId> --idempotency-key demo-1
fuma sync status
```

完整步骤见 [docs/快速开始.md](docs/快速开始.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/README.md](docs/README.md) | 文档总索引（需求/契约/数据/实现） |
| [docs/快速开始.md](docs/快速开始.md) | 安装、登录、常用命令 |
| [docs/运维部署手册.md](docs/运维部署手册.md) | 部署、备份恢复、升级回滚、排障、安全 |
| [docs/generated/CLI参考.md](docs/generated/CLI参考.md) | **CLI 全命令参考**（自动生成） |
| [docs/generated/REST-API.md](docs/generated/REST-API.md) | **REST API 参考**（自动生成） |
| [docs/generated/MCP工具.md](docs/generated/MCP工具.md) | **MCP 工具参考**（自动生成） |
| [docs/03-上游接口契约-孚盟.md](docs/03-上游接口契约-孚盟.md) | 孚盟上游接口契约（抓包实证） |
| [docs/04-平台API契约.md](docs/04-平台API契约.md) | 平台对外契约（四入口） |
| [docs/05-数据模型与同步设计.md](docs/05-数据模型与同步设计.md) | SQLite 模型 / 同步 / 对账 |
| [docs/06-登录与会话管理.md](docs/06-登录与会话管理.md) | 登录/二维码/保活 |
| [docs/10-实现进度与验证报告.md](docs/10-实现进度与验证报告.md) | 实现进度与真实验证 |
| [docs/性能与容量报告.md](docs/性能与容量报告.md) | 基准与容量 |

## 架构

```
CLI (commander)   REST (127.0.0.1, Bearer)   MCP (stdio)   SKILL
        └──────────────┬────────────────────────────┘
                 Runtime / Dispatch
   ┌────────────┬─────────────┬──────────────┬─────────────┐
   │ Account/Session│ RequestPool │ Local Store (SQLite) │ Rules/Service │
   └────────────┴─────────────┴──────────────┴─────────────┘
                 │ UpstreamClient (GET query / POST body token)
                 ▼
         fumamx.com/pcapi  （登录经 cloakbrowser + 钉钉 SSO）
```

- 运行时只常驻 Node 进程；浏览器仅在登录/重登/二维码刷新时拉起（默认不常驻）。
- 数据目录：`~/.fuma-platform`（DB、secret、profiles、logs、backups、qr）。

## 开发

```bash
npm install
npm run typecheck
npm test                 # 53 个用例（需要 --experimental-sqlite，已内置于脚本）
npm run build
npm run spec             # 生成 spec/*.json
npm run docs:gen         # 生成 docs/generated/*
npm run bench            # 性能基准（mock 上游）
```

## 状态与已知限制

- v1.0.0：P2–P6 完成，文档/部署/基准/测试齐备。
- 上游删除客户接口受账号权限限制（当前验证账号无删除权限）。
- 完整扫码登录、24h 保活实验、免扫码重登实验需在目标账号上人工联调。
- 海关仅按公司查询；产品/交易分析与贸易监测不在 MVP。
- 详见 [docs/10-实现进度与验证报告.md](docs/10-实现进度与验证报告.md)。

## 安全

- `.env`、`~/.fuma-platform`（token/密钥/数据）权限 600，已被 gitignore。
- 日志/事件脱敏；token 使用 AES-256-GCM 加密存储。
- REST 默认仅 127.0.0.1；请勿直接暴露公网。
- 合规：账号为真实业务员账号，请遵守孚盟使用条款并控制访问频率。

## License

[MIT](LICENSE) © 2026 fuma-platform contributors
