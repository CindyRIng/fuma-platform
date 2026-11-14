# Fuma Platform 文档

> 孚盟（fumamx.com）本地封装平台。当前版本：**v1.0.7（P2–P6 完成）**。
> 快速入口：[快速开始](快速开始.md) ｜ [运维部署手册](运维部署手册.md) ｜ [CLI 参考](generated/CLI参考.md) ｜ [REST API](generated/REST-API.md) ｜ [MCP 工具](generated/MCP工具.md)

## 文档地图

| 文档 | 内容 |
|---|---|
| [00-需求访谈记录](00-需求访谈记录.md) | 需求决策记录（D1–D10） |
| [01-项目总览与架构](01-项目总览与架构.md) | 定位/架构/数据流/容量/取舍/风险 |
| [02-需求规格与业务规则](02-需求规格与业务规则.md) | FR/NFR/BR/AC、决策落库、海关缓存需求 |
| [03-上游接口契约-孚盟](03-上游接口契约-孚盟.md) | 登录/会话/鉴权、9 域接口目录、筛选 DSL、容量/公海规则、写接口源码级打通 |
| [04-平台API契约](04-平台API契约.md) | envelope、四入口映射、能力定义、错误/事件/任务、决策后契约 |
| [05-数据模型与同步设计](05-数据模型与同步设计.md) | SQLite DDL、状态机、规则引擎、outbox/对账、请求池、海关缓存 |
| [06-登录与会话管理](06-登录与会话管理.md) | 快登录/免扫码实验/长期保活/E1–E5 实验方案 |
| [07-实现设计与工程规范](07-实现设计与工程规范.md) | 实现级设计、并发/错误/测试、P2–P6 任务 |
| [08-文档评审与问题清单](08-文档评审与问题清单.md) | 一致性修正、契约缺口、决策回执、DoR |
| [09-文档完整校验报告](09-文档完整校验报告.md) | 最终校验结果 |
| [10-实现进度与验证报告](10-实现进度与验证报告.md) | **实现进度、真实上游验证、已知限制** |
| [性能与容量报告](性能与容量报告.md) | 基准结果与优化项 |
| [快速开始](快速开始.md) | 安装/登录/常用命令 |
| [运维部署手册](运维部署手册.md) | 部署/备份/升级/排障/安全 |
| [generated/CLI参考](generated/CLI参考.md) | CLI 全命令（自动生成） |
| [generated/REST-API](generated/REST-API.md) | REST 全接口（自动生成） |
| [generated/MCP工具](generated/MCP工具.md) | MCP 工具（自动生成） |
| [generated/能力总览](generated/能力总览.md) | 能力矩阵（自动生成） |

## 生成物

- `spec/openapi.json`、`spec/cli-commands.json`、`spec/mcp-tools.json`（`npm run spec`）
- `docs/generated/*`（`npm run docs:gen`）

## 证据（本机，gitignore）

- `exploration/2026-11-14/live-capture.md`：多轮现场抓包记录
- `data/exploration/2026-11-14/`：浏览器/HTTP 侦察证据（含敏感信息，不入库）
