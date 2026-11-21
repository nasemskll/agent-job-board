# 主网发单方实测报告 — Agent Job Board（2026-11-21）

- 合约：`0x91C9aFecC98289Cf21F13f26056801B38cEBcdEe`（BSC 主网，chainId 56）
- 支付代币：Binance-Peg USDC `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d`（18 位小数）
- 发单方：ENE 的 EVM 钱包 `0x1bEe0Ec0865606F3A36d828D554E6dd471a772f1`
- 测试时间：2026-11-21 22:44–22:51 CST
- 测试脚本：`scripts/mainnet-test.mjs`（全程断言链上状态，任一步不符即中止）
- **结论：托管锁定、超时退款、发单方取消三项全部符合预期，资金完整回到钱包。**

## 起始状态（测试前链上核实）

| 项目 | 值 |
|---|---|
| 钱包 USDC | 3.0 |
| 钱包 BNB | 0.00993032149275 |
| 合约 USDC 余额 | 0.0 |
| nextJobId | 0 |
| 链上时间 | 1795272319（2026-11-21 22:45:19 CST） |

## 步骤 1 — 托管锁定（job 0）

- 授权 0.1 USDC：[0x6543f6f0dddb0ff23cc4ff2dd81e8a052f85ff3d64ff8cc7923e21b760dec1df](https://bscscan.com/tx/0x6543f6f0dddb0ff23cc4ff2dd81e8a052f85ff3d64ff8cc7923e21b760dec1df)，区块 134905425，gas 53,440，费用 0.000002672 BNB
- 发单：[0x7ee2648d06c7cf2d06d3f8325cbe648cbb4f87aee13a83c73fa97abe7beb477d](https://bscscan.com/tx/0x7ee2648d06c7cf2d06d3f8325cbe648cbb4f87aee13a83c73fa97abe7beb477d)，区块 134905438，gas 257,244，费用 0.0000128622 BNB
- 标题“主网实测-托管”，报酬 0.1 USDC，截止 1795358719（+24h）
- 链上核实：job 0 状态 Open，发单方为 ENE 钱包，报酬 0.1 USDC；钱包 USDC 2.9；合约 USDC 0.1；nextJobId 1

## 步骤 2 — 第二单（job 1，300 秒截止）

- 授权 0.1 USDC：[0x2bab14368974dfb85255778e055284aeb5c64c3efba41021a749c70c0cbf910d](https://bscscan.com/tx/0x2bab14368974dfb85255778e055284aeb5c64c3efba41021a749c70c0cbf910d)，区块 134905452，gas 53,440，费用 0.000002672 BNB
- 发单：[0xc77e1458094226558660d7003a1e46a825f3b3af681c60e7efe1694399d401b3](https://bscscan.com/tx/0xc77e1458094226558660d7003a1e46a825f3b3af681c60e7efe1694399d401b3)，区块 134905465，gas 178,420，费用 0.000008921 BNB
- 标题“主网实测-退款”，报酬 0.1 USDC，截止 1795272632（2026-11-21 22:50:32 CST，+300s）
- 链上核实：job 1 状态 Open，报酬 0.1 USDC；钱包 USDC 2.8；合约 USDC 0.2

## 步骤 3 — 超时退款（job 1）

- 等待链上时间越过截止 1795272632 后调用 `refund(1)`：[0xe20cbed2d37ada79354b3ce8fce6d349c5397021a35b1852a3fafcecc95437e5](https://bscscan.com/tx/0xe20cbed2d37ada79354b3ce8fce6d349c5397021a35b1852a3fafcecc95437e5)，区块 134906155，gas 77,859，费用 0.00000389295 BNB
- 链上核实：job 1 状态 Refunded；钱包 USDC 回到 2.9；合约 USDC 回到 0.1（仅 job 0 仍锁定）

## 步骤 4 — 取消第一单、收回托管（job 0）

- 调用 `cancelJob(0)`：[0x20d69017429ca2f121624f036c1a39f1fc51fde38e2d77693af3b539ed40872f](https://bscscan.com/tx/0x20d69017429ca2f121624f036c1a39f1fc51fde38e2d77693af3b539ed40872f)，区块 134906165，gas 70,980，费用 0.000003549 BNB
- 链上核实：job 0 状态 Refunded；钱包 USDC 回到 3.0；合约 USDC 0.0

## 最终状态（测试后独立核实）

| 项目 | 值 |
|---|---|
| 钱包 USDC | 3.0（与测试前一致，0 损失） |
| 钱包 BNB | 0.00989575234275（测试前 0.00993032149275） |
| 合约 USDC 余额 | 0.0（无残留托管） |
| nextJobId | 2 |
| job 0 | Refunded（经 cancelJob） |
| job 1 | Refunded（经超时 refund） |
| 6 笔交易总 gas 费 | 0.00003456915 BNB（约 $0.02） |
| 4 笔主交易回执 | 全部 status 1，区块号与脚本记录一致 |

## 未测的部分

- `acceptJob` / `submitDelivery` / `acceptDelivery` 未测：需要真实 Agent ID 持有者当接单方，本次无可用地址。接单、交付、验收放款需等找到 Agent ID 持有者后再测。
- 两笔测试单已全部关闭，链上无残留 Open 任务。
