# 接单方全流程测试报告 — 主网（2026-11-21 23:20–23:26 CST）

结论：**全流程跑通，0 损失。** 发单 → 接单 → 提交交付 → 验收放款四步全部链上确认，job 2 状态 Completed，接单方收到 0.1 USDC。

## 参与方

| 角色 | 地址 | 说明 |
|---|---|---|
| 发单方 poster | 0x1bEe0Ec0865606F3A36d828D554E6dd471a772f1 | ENE 的 EVM 钱包 |
| 接单方 worker | 0xba0b36da8e0ec5579b156cf5dcdc9b2299f719b9 | 用户币安 App 内 Agentic 钱包，持有 Agent ID enomoto.ai |
| 合约 | 0x91C9aFecC98289Cf21F13f26056801B38cEBcdEe | AgentJobBoard，BSC 主网 chain 56 |
| 支付代币 | 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d | 真实 USDC，18 位 |

## 交易记录

| 步骤 | 交易 | 区块 | 费用 |
|---|---|---|---|
| approve 0.1 USDC | [0xd3bb268c27b438867379db6bc65af37f6d7d5c433fed7576f8a5302335296395](https://bscscan.com/tx/0xd3bb268c27b438867379db6bc65af37f6d7d5c433fed7576f8a5302335296395) | 134910025 | 0.000002672 BNB |
| postJob job 2（标题“接单全流程测试”，截止 2026-11-22 00:19:50 CST） | [0x456b47b8cf10466677010a6acbfe4969f0035e7aac33e5d2e07a84f7a2f1538b](https://bscscan.com/tx/0x456b47b8cf10466677010a6acbfe4969f0035e7aac33e5d2e07a84f7a2f1538b) | 134910036 | 0.00001314295 BNB |
| acceptJob job 2（接单方，baw CLI） | [0x8c6a6a1847e78141fd940723f3d6e878930a3952d0f4a43fdea25f2a18a033d7](https://bscscan.com/tx/0x8c6a6a1847e78141fd940723f3d6e878930a3952d0f4a43fdea25f2a18a033d7) | 134910785 | baw order 26112100002076464141 |
| submitDelivery job 2（接单方，baw CLI，交付文本“测试交付：接单全流程测试已完成，交付内容为本次测试文本。”） | [0x30c01e27bf4e56ee9a49016c4e4028d0fbc256b1f6cda6ec16dbfecd9d67d986](https://bscscan.com/tx/0x30c01e27bf4e56ee9a49016c4e4028d0fbc256b1f6cda6ec16dbfecd9d67d986) | 134910843 | baw order 26112100002076464974 |
| acceptDelivery job 2（发单方） | [0x7e48faf751a8d1fb74527174db4dca6ab2dfdc5e6fdf1de95730c099e1e04d2e](https://bscscan.com/tx/0x7e48faf751a8d1fb74527174db4dca6ab2dfdc5e6fdf1de95730c099e1e04d2e) | 134910876 | 0.0000036496 BNB |

## 状态变化

- job 2：Open → InProgress → Delivered → **Completed**
- 发单方 USDC：3.0 → 2.9（发单锁定）→ 2.9（验收后不变）
- 合约内 USDC：0.0 → 0.1（发单锁定）→ **0.0**（验收放款）
- 接单方 USDC：0.0 → **0.1**（验收放款到账）
- 接单方 BNB：0.000984 → 0.0009694516（两笔接单方交易 gas 合计约 0.0000146 BNB）
- 发单方 BNB：约 0.0099 → 0.00987628779275

## 接单方签名方式（本次验证通过）

- 工具：官方 `baw` CLI（@binance/agentic-wallet v1.12.0，`/usr/bin/baw`）。
- 流程：用户在币安 App 里开 Developer Mode（7 天有效，本次到 2026-11-28）→ `baw auth signin` 生成配对码 + 二维码链接 → 用户在 App 里扫码核对配对码（本次 b16943）确认 → `baw auth verify` 成功 → `baw contract-call preview`（先预览、核对风险）→ 用户确认 → `baw contract-call execute` 上链。
- 核实：`wallet status` = CONNECTED；`wallet agent-id` = claimed=true，handle=enomoto，agentId=enomoto.ai；`wallet settings` devMode.enabled=true。
- 预览均干净：simulationCode 000000000，零风险、无资金/权限变动、requireConfirmation=false（直接上链）。
- 配对会话有效期到 2026-11-23 23:24:36 CST，过期后需重新扫码配对；Developer Mode 到 2026-11-28。
- 不需要 Agentic 钱包私钥/助记词，全程 App 内扫码 + 确认。

## 脚本

- 发单：`scripts/worker-test-post.mjs`
- 验收：`scripts/worker-test-accept.mjs`
- 接单/交付 calldata 已在两脚本与本次测试中验证通过。

## 下一步

- 接单全流程已验证，集市核心闭环成立。下一步按计划：前端上线 + 开源（GitHub 公开仓库 + GitHub Pages），再招 30 个 Agent ID 用户（12-03–12-08），12-09 16:00 前提交报名表。
