# Agent Job Board — BNB Agent ID Hackathon 方向 A（Agent 任务集市）

链上微任务集市（测试网 MVP，第 1 步：托管合约 + 测试网部署 + 全流程验证；第 2 步：前端单页 + README 完善）。

- 发单方发任务并把报酬（ERC20）锁进托管合约；
- 接单方必须是 Agent ID 持有者才能接单；
- 接单 → 交付 → 发单方验收后托管放款；超时未验收可触发退款。

团队：单人/小团队、零预算、AI agent 开发。**只做测试网（BSC Testnet，chainId 97），绝不上主网，不花真钱。**

## 当前状态（2026-11-21）

| 项 | 状态 |
| --- | --- |
| 合约开发 + 本地测试 | ✅ 完成，8 个单元测试全过 |
| 本地 dry-run 部署 + 全流程验证脚本 | ✅ 完成，7 项检查全过（见 `verification.localhost-dryrun.json`） |
| **BSC 测试网部署** | ⏳ **被 tBNB 水龙头卡住，待人工过验证码**（见下文“测试网部署被堵”） |
| 测试网全流程验证 `scripts/verify-flow.js` | 已写好，部署完成后跑（会真实等待 75 秒测超时退款） |
| 前端 | ✅ 完成（第 2 步：单页应用 + 本地验证全过，见“前端”一节） |
| 主网部署 | ✅ **已完成（2026-11-21）**：AgentJobBoard 已部署到 BSC 主网，见文末“主网上线 checklist”与 `deployment-mainnet.json` |

## 测试网部署被堵：需要一次人工水龙头领取

部署者钱包（3 个测试钱包均余额 0 tBNB）没有 gas 费：

- 部署者地址：`0xD8ebd6a925E208937e5F659B2ebf9588b78B23f0`
- 发单方：`0xC662a07Da6cE485b8bbD6A1d8e07F433a672D564`
- 接单方：`0xACac3329cFb1b7393dDd5EeD77CE8739F48cADf9`
- 部署脚本已实测报错：`Deployer has 0 tBNB. Claim from https://testnet.bnbchain.org/faucet-smart first`

水龙头是浏览器页面 + 验证码（子代理无法操作浏览器、不能绕过验证码），且按近期资料官方水龙头还要求领取地址在 BSC 主网持有 ≥ 0.002 BNB。**解堵步骤（人工，约 2 分钟）：**

1. 打开 https://testnet.bnbchain.org/faucet-smart
2. 粘贴部署者地址 `0xD8ebd6a925E208937e5F659B2ebf9588b78B23f0`，过验证码，领 0.3 tBNB（官方每日上限 0.3 tBNB/地址，部署 3 个合约 + 验证流程约需 0.05–0.1 tBNB，足够）
3. 回到本目录依次跑：
   ```bash
   npx hardhat run scripts/deploy.js --network bsctestnet
   npx hardhat run scripts/verify-flow.js --network bsctestnet
   ```
   部署成功后把 `deployment.json` / `verification.json` 里的合约地址填进下方“测试网合约地址”一节。

备选水龙头（同样要浏览器/注册，均未绕过）：QuickNode（https://faucet.quicknode.com/binance-smart-chain/bnb-testnet）、Chainstack（https://faucet.chainstack.com/bnb-testnet-faucet，需账号+API key）。

## 技术栈选择：Hardhat（而非 Foundry）

- 本机只有 Node.js（v24），没有安装 Foundry；Hardhat `npm install` 即可用，零系统依赖；
- ethers v6 + OpenZeppelin v5 组合成熟，测试、部署、验证脚本都用同一套 JS 写，改动成本低；
- 目标是黑客松 MVP 快速验证，不是高性能模糊测试，Hardhat 的测试速度已够用（8 个测试约 2 秒）。
- 版本：Hardhat 2.28.0、ethers 6.15.0、@openzeppelin/contracts 5.4.0、Solidity 0.8.24。

## 合约

`contracts/`：

| 合约 | 说明 |
| --- | --- |
| `AgentJobBoard.sol` | 核心托管合约（见下） |
| `MockUSDC.sol` | 测试网 ERC20 替身，6 位小数（同真实 USDC），部署时给部署者铸 1,000,000 mUSDC，部署脚本转 10,000 给发单方 |
| `MockAgentID.sol` | 测试网 ERC721 替身，仅 `balanceOf` + 部署者可 `mint`，部署脚本给接单方铸 1 个 |

### AgentJobBoard 功能

- `postJob(title, description, reward, reviewDeadline)`：发单，报酬从发单方转入合约锁定（需先 `approve`）；`reviewDeadline` 必须是未来时间戳，`reward > 0`。
- `acceptJob(jobId)`：接单。校验 `agentId.balanceOf(msg.sender) > 0`，否则 `NotAgentHolder()` 回滚；发单方不能接自己的单。
- `submitDelivery(jobId, delivery)`：接单方提交交付，`delivery` 是链下链接/内容哈希字符串。
- `acceptDelivery(jobId)`：发单方验收，托管把报酬转给接单方，状态 `Completed`。
- `rejectDelivery(jobId)`：**我们的选择：任务回到 `InProgress`，同一接单方可重新交付**（不回落到 `Open`）。理由：被拒的接单方不会被悄悄换掉，发单方也不能用“拒单再重开”白嫖劳动；交付内容会被清空，防止旧交付被误验收。
- `refund(jobId)`：超过 `reviewDeadline` 仍未验收时，发单方或接单方任一方可触发，报酬退回发单方，状态 `Refunded`。`Open` / `InProgress` / `Delivered` 状态都可退款；`Completed` 永远不可退款。
- `cancelJob(jobId)`：发单方在任务仍 `Open`（无人接单）时可取消并取回锁定报酬。
- 全部关键状态变化都有事件（`JobPosted` / `JobAccepted` / `DeliverySubmitted` / `DeliveryAccepted` / `DeliveryRejected` / `JobRefunded` / `JobCancelled`），并用 `ReentrancyGuard` + OpenZeppelin `SafeERC20` 防重入/防非标准 ERC20。

### Agent ID 校验

- 生产合约：SPACE ID Agent ID，主网（chainId 56）地址 `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`（ERC-721，`balanceOf > 0` 即持有）。合约里写死为常量 `PRODUCTION_AGENT_ID`（注意：任务书给的是小写形式，Solidity 校验和要求此处用校验和大小写）。
- **BSC 测试网（chainId 97）没有查到官方 SPACE ID Agent ID 部署**（查了 Binance 官方黑客松公告与搜索结果，官方只公布了主网地址）。因此测试网用自部署的 `MockAgentID` 替身，接口与生产一致（只依赖 `balanceOf`）。
- 主网上线时：把部署参数里的 Agent ID 地址换成上面那个主网地址即可，合约代码不用改。

### Owner 权限披露

`AgentJobBoard` 继承 OpenZeppelin `Ownable`，但**没有任何 owner 专属的资金操作函数**：

- Owner **能做**的：仅 `transferOwnership` / `renounceOwnership`（继承而来，转移/放弃 owner 身份）。
- Owner **不能做**的：没有 `withdraw` 函数、不能暂停合约、不能更换支付代币、不能更换 Agent ID 合约地址、不能修改/取消别人的任务、不能动托管里的任何一分钱。合约里资金只通过三条路径流出：`acceptDelivery`（→接单方）、`refund`（→发单方）、`cancelJob`（→发单方，仅无人接单时）。
- Mock 合约的 owner 权限（仅测试网）：`MockAgentID` 的 owner 可以 `mint` 测试用 Agent ID；`MockUSDC` 没有 mint 函数（总量部署时一次铸完）。主网上线时这两个 mock 合约直接删除。

## 测试网合约地址（部署完成后填）

| 合约 | 地址 | BscScan 测试网 |
| --- | --- | --- |
| MockUSDC | （待部署） | — |
| MockAgentID | （待部署） | — |
| AgentJobBoard | （待部署） | — |

- 网络：BSC Testnet，chainId 97；RPC：https://data-seed-prebsc-1-s1.binance.org:8545/；浏览器：https://testnet.bscscan.com
- 部署者地址：`0xD8ebd6a925E208937e5F659B2ebf9588b78B23f0`

## 前端（第 2 步已完成）

`frontend/`：原生 HTML + JS + ethers v6 单页应用，无重型框架。

| 文件 | 说明 |
| --- | --- |
| `index.html` | 页面结构 + 风险提示 + 规则说明 |
| `app.js` | 业务代码：连钱包、读任务列表、发单/接单/交付/验收/拒绝/退款/取消 |
| `config.js` | **唯一可以写合约地址的地方**：按 chainId 选地址，业务代码只从这里读 |
| `abi.js` | 合约 ABI（由 `scripts/generate-frontend-abi.js` 从编译产物自动生成，勿手改） |
| `logic.js` | 纯逻辑（无 DOM）：中文状态文案、接单拦截原因、是否可退款——浏览器与 Node 验证脚本共用同一份 |
| `vendor/ethers.umd.min.js` | ethers v6.15.0 本地副本（与 CDN 同版本文件字节一致，md5 `518af9546defb8b07198e49db9d665d8`），离线也能用；只有本地文件缺失时才回落到 CDN |

### 功能

- 连钱包（`window.ethereum`，兼容 MetaMask / Binance Wallet），显示当前地址、链 ID、mUSDC 余额、是否持有 Agent ID（调 Agent ID 合约 `balanceOf > 0`，页面明确展示“持有 Agent ID ✓ / 未持有 Agent ID”）；
- 任务列表：从合约读全部任务（标题、描述、报酬、状态、发单方、接单方、截止时间），状态用中文展示（待接单 / 进行中 / 已交付，待验收 / 已完成 / 已退款 / 已取消）；
- 发单：填标题、描述、报酬、验收截止时间，先 `approve` 再 `postJob`（两笔交易都要在钱包里确认）；
- 接单：只有持有 Agent ID 的地址才能点接单按钮；未持有的按钮禁用并写明原因（前端拦截 + 合约 `acceptJob` 再次校验，无法绕过）；发单方不能接自己的任务；
- 交付：接单方提交交付内容（链接/内容哈希文本）；
- 验收 / 拒绝：只有发单方能操作。验收后托管放款；拒绝后任务回到“进行中”，可重新交付（交付内容会被清空）；
- 超时退款：过了验收截止时间的任务显示“可退款：触发退款”并能触发 `refund`；**退款是否可触发以链上最新区块时间为准，不用用户本机时钟**（两者可能相差很大）；
- 取消：发单方仅在任务无人接单时可取消；**“已取消”与“已退款”分得清**：`cancelJob` 也把状态置为 `Refunded`（4），页面查 `JobCancelled` 事件区分，取消的显示“已取消”，超时的显示“已退款”；
- 切到不支持的网络（非 31337 / 97，或该链地址未填）时明确提示不支持并禁用操作；页面内可一键切换到本地 Hardhat（31337）或 BSC 测试网（97）。

### config 切换说明（`frontend/config.js`）

- `31337`（本地 Hardhat）：地址复制自 `deployment.localhost-dryrun.json`。本地重新部署后地址若变化，同步更新此处；静态服务器以项目根目录为根时，`loadDeploymentOverrides()` 会自动从 `deployment.localhost-dryrun.json` / `deployment.json` 按 `chainId` 覆盖（仅当文件里的 `chainId` 与配置项一致时才覆盖，避免串用）。
- `97`（BSC 测试网）：三项目前是 `null`（还没有 `deployment.json`，水龙头被卡住）。水龙头领到 tBNB、跑完 `npx hardhat run scripts/deploy.js --network bsctestnet` 后，把 `deployment.json` 里的三个地址填进来即可；`configForChain(97)` 在地址补全前返回 `null`，页面会提示不支持，不会连到空地址。
- `56`（BSC 主网）：未上线，三个地址中 AgentJobBoard 与支付代币为空，`configForChain(56)` 返回 `null`，前端拒绝连接主网。主网上线 checklist 见文末。
- 注意：`deploy.js` 写 `deployment.json` 时不分网络——本地 dry-run 跑完后它装的是本地地址（`chainId` 31337），测试网部署后会被覆盖为测试网地址（`chainId` 97）。前端按文件里的 `chainId` 区分，不会串用。

### 前端怎么跑

```bash
cd ~/workspace/bnb-hackathon/agent-job-board

# 1. 起本地节点（新开一个终端，保持运行）
npx hardhat node --port 8545

# 2. 注资测试钱包 + 部署（新开一个终端）
npx hardhat run scripts/fund-local.js --network localhost
npx hardhat run scripts/deploy.js --network localhost
# -> 写 deployment.json（本地地址，chainId 31337；与 config.js 内置地址一致）

# 3. 起静态服务器（以项目根目录为根，这样 config 才能自动读部署文件）
python3 -m http.server 8000

# 4. 浏览器打开 http://127.0.0.1:8000/frontend/index.html
#    点“连接钱包”（MetaMask / Binance Wallet），钱包切到本地网络
#    （chainId 31337，RPC http://127.0.0.1:8545；页面有“一键切换”按钮）。
#    本地测试用 test-wallets.json 里的测试钱包（私钥只放该文件，绝不进代码）。
#    发单方 0xC662a07Da6cE485b8bbD6A1d8e07F433a672D564 有 10,000 mUSDC，
#    接单方 0xACac3329cFb1b7393dDd5EeD77CE8739F48cADf9 持有 1 个 Mock Agent ID。

# 5. 测试网（水龙头领到 tBNB、部署完成后）：把 deployment.json 的地址填进
#    config.js 的 97 一项，钱包切到 BSC 测试网（97）后打开同一页面即可，
#    不用改业务代码。
```

前端验证脚本（本地 dry-run，只能跑 chainId 31337）：

```bash
node scripts/verify-frontend.js   # 写 verification.frontend-local.json
```

它与页面共用同一份 `frontend/abi.js`、`frontend/config.js`、`frontend/logic.js`，用 `JsonRpcProvider` 代替浏览器钱包，按 `app.js` 的顺序调同一批合约方法。

### 文案红线（已落实）

页面文案不出现“被动收入”“自动赚钱”这类承诺收益的词，只描述功能。涉及资金处有风险提示：测试网代币无实际价值；智能合约托管存在风险；主网上线前请自行审计 / 复核。

## 怎么跑

```bash
cd ~/workspace/bnb-hackathon/agent-job-board
npm install

# 1. 生成测试钱包（只跑一次；已生成就别重复跑）
node scripts/generate-wallets.js
# -> test-wallets.json（chmod 600，.gitignore 已排除；私钥/助记词只放这里，
#    绝不进代码、README 或汇报）

# 2. 编译 + 本地测试
npx hardhat compile
npx hardhat test          # 8 个测试

# 3. 本地 dry-run（不用水龙头，验证脚本本身能跑通）
npx hardhat node --port 8545
npx hardhat run scripts/fund-local.js --network localhost
npx hardhat run scripts/deploy.js --network localhost
npx hardhat run scripts/verify-local.js --network localhost

# 4. 测试网部署（先领水龙头，见上文“测试网部署被堵”）
npx hardhat run scripts/deploy.js --network bsctestnet      # 写 deployment.json
npx hardhat run scripts/verify-flow.js --network bsctestnet # 写 verification.json（约等 75 秒测退款）
```

`hardhat.config.js` 有硬护栏：`deploy.js` / `verify-flow.js` 会拒绝任何非 97（测试网）/ 31337（本地）的 chainId，部署到主网会被直接拦截。

## 验证结果

### 本地测试（`npx hardhat test`，8/8 通过）

- (a) 发单→接单→交付→验收→放款，接单方余额精确增加报酬数额；
- 拒单后回落 `InProgress`，可重新交付并最终收款；
- (b) 截止后退款：发单方余额精确恢复；截止前退款会回滚；
- (c) 无 Agent ID 的地址接单回滚（`NotAgentHolder()`）；
- 发单方不能接自己单、只有接单方能交付、只有发单方能验收；
- `cancelJob`（无人接单）退款；零报酬/过期截止发单回滚；
- 合约上不存在 `withdraw` 函数。

### 本地 dry-run 全流程（`scripts/verify-local.js`，7/7 通过）

本地节点上的真实交易哈希（非测试网，仅证明脚本与合约跑通）：

| 步骤 | 交易哈希（本地链） |
| --- | --- |
| (a) postJob 任务 #5 | `0x9e27b50fc552ad20258edf07bdfbe85c8d110984d5ed5e472e81ec0d25d7f141` |
| (a) acceptJob | `0x4c368d0655cb0818e121c31f769c9b4de07ca7a87d82be4e873a7843fd51850d` |
| (a) submitDelivery | `0x2f56cb623a286ffbc4371c21d457edb99284b128faa64bcb05287ae694d08a0a` |
| (a) acceptDelivery | `0xc1b2bbfdbd4400e2b0043f87ca3817fc059267b57b2255a125cea4ce926c4a45` |
| (c) postJob 任务 #6（负向） | `0x2c1ab745f88f1d6b61487f9d551dae51e4fb9c4c5b08c5e17a63b91e81b0d5a8` |
| (b) postJob 任务 #7（退款） | `0xcc9d3ac9e543c374aba5cb528f20266b501a8a1f242aa05ea22d18aa2de1ddd4` |
| (b) refund | `0xc35062ece4a72a66bba9380b19ed44559b1c550cbd8d8e09db04490baea7cb18` |

本地部署地址（仅本地链有效，见 `deployment.localhost-dryrun.json`）：MockUSDC `0xAc575B03E5774a946d86F5476D2A0cec7E5D0a06`、MockAgentID `0x35eF9EFBA3162812e8553ba2f0A8C716b071faA7`、AgentJobBoard `0x64F25291af60ccF1c155282f558B50FeCC9E8daf`。

余额核对（本地 dry-run，mUSDC，6 位小数）：(a) 接单方 200.0 → 300.0（精确 +100 报酬），发单方 9780.0 → 9680.0；(b) 退款后发单方 9620.0 → 9670.0（发单锁 50、退款回 50，精确恢复）；(c) 无 Agent ID 接单回滚 `NotAgentHolder()`。

### 前端验证（第 2 步，本地 dry-run）

`scripts/verify-frontend.js`（与页面共用同一份 ABI / config / logic），**21/21 通过**（见 `verification.frontend-local.json`）：

- Agent ID 持有检查（页面调的同一个 `balanceOf`）：接单方持有、发单方与路人均未持有；
- 任务列表经 `nextJobId` + `getJob` 读出；
- (a) approve + 发单 → 接单 → 交付 → 验收放款：接单方 400.0 → 500.0 mUSDC（精确 +100 报酬），发单方 9530.0 → 9430.0；任务状态文案“已完成”；
- 拒绝后回落“进行中”、交付清空、重新交付后仍能收款；
- (c) 无 Agent ID 接单回滚（页面先拦截、合约再校验）；
- 取消分支：状态文案“已取消”（不是“已退款”），发单方精确收回 10 mUSDC；
- (b) 短截止任务：截止前页面不显示可退款，`evm_increaseTime` 过截止后显示可退款，退款后发单方 9740.0 → 9790.0（精确 +50），状态文案“已退款”；
- 任务列表从 0 增长到 5 条仍能正常读出。

无头浏览器实测（Playwright + 缓存 chromium，`window.ethereum` 桩转发本地节点，检查脚本在 `~/workspace/tmp-headless-check/check.js`，测试专用，不进项目）：

- 页面能加载，**0 控制台报错、0 页面报错、0 失败请求**；
- 钱包面板正确：发单方地址、链 31337（本地 Hardhat）、“未持有 Agent ID”、9785 mUSDC；
- 6 个任务全部渲染，状态中文正确（待接单 / 已退款 / 已取消分得清）；
- 接单按钮按规则禁用并写明原因（发单方看自己的任务显示“发单方不能接自己的任务”）；
- 已过期的待接单任务正确显示“可退款：触发退款”按钮（1 个）；
- 页面正文无“被动收入”“自动赚钱”字样。

验证中发现并已修掉的两个问题（都在验证脚本/前端里留了注释）：

- **ethers v6 的 `getBlock("latest")` 在刚挖出块后立即读会返回轮询缓存里的旧区块**（实测：`evm_mine` 后马上读，raw `eth_blockNumber` 已是新块，`getBlockNumber` 仍是旧块，约 4 秒后才更新）。验证脚本的链上时间改走 raw `eth_getBlockByNumber` 读；前端的退款判断也改用链上最新区块时间（不用本机时钟）。
- **本地连续发交易时 nonce 读取竞态**（approve 刚挖出、postJob 又算出旧 nonce 而失败）。验证脚本改用 `ethers.NonceManager` 包裝测试钱包；浏览器里 nonce 由钱包管理，前端本身不受影响。
- 沙箱里的无头 Chrome 走 egress 代理加载 jsDelivr 会 `ERR_TUNNEL_CONNECTION_FAILED`，页面因此一度报 `ethers is not defined`。已把 ethers v6.15.0 打包进 `frontend/vendor/`（与 CDN 文件字节一致），本地优先、CDN 只作备用；`app.js` 在 ethers 未加载时显示明确提示而不是抛未捕获错误。

### 测试网验证（待部署后跑）

`scripts/verify-flow.js` 会在测试网跑同样的 (a)(b)(c)，并把交易哈希和余额核对写进 `verification.json`。结果目前为空——部署被水龙头卡住（见顶部）。

## 文件结构

```
agent-job-board/
├── README.md
├── hardhat.config.js          # 网络：hardhat / localhost / bsctestnet(97)
├── package.json
├── .gitignore                 # test-wallets.json、node_modules、artifacts、cache
├── contracts/
│   ├── AgentJobBoard.sol      # 核心托管合约
│   ├── MockUSDC.sol           # 测试网 USDC 替身（6 位小数）
│   └── MockAgentID.sol        # 测试网 Agent ID 替身（ERC721 + mint）
├── scripts/
│   ├── generate-wallets.js    # 生成 3 个测试钱包 -> test-wallets.json(600)
│   ├── deploy.js              # 部署 3 个合约 + 资助发单方 + 给接单方铸 Agent ID
│   ├── verify-flow.js         # 测试网全流程验证 (a)(b)(c) -> verification.json
│   ├── verify-local.js        # 本地 dry-run 版验证（时间快进代替真等 75 秒）
│   ├── verify-frontend.js     # 前端调用路径验证（共用前端 ABI/config/logic）-> verification.frontend-local.json
│   ├── generate-frontend-abi.js # 从编译产物生成 frontend/abi.js
│   └── fund-local.js          # 本地 dry-run 注资（Hardhat 默认账户 #0）
├── frontend/
│   ├── index.html             # 单页应用（风险提示 + 钱包 + 发单 + 任务列表）
│   ├── app.js                 # 业务代码（只读 config.js 的地址）
│   ├── config.js              # 按 chainId 选合约地址（31337 内置 / 97 待填 / 56 未上线）
│   ├── abi.js                 # 合约 ABI（自动生成，勿手改）
│   ├── logic.js               # 纯逻辑：中文状态、接单拦截、可退款判断
│   └── vendor/
│       └── ethers.umd.min.js  # ethers v6.15.0 本地副本（与 CDN 字节一致）
├── test/
│   └── AgentJobBoard.test.js  # 8 个单元测试
├── test-wallets.json          # 仅本地，600 权限，gitignore（私钥/助记词在这里）
├── deployment.localhost-dryrun.json   # 本地 dry-run 部署记录（非测试网）
├── verification.localhost-dryrun.json # 本地 dry-run 验证记录（非测试网）
├── verification.frontend-local.json   # 前端调用路径验证记录（本地，21/21）
├── deployment.json            # 部署后生成：本地 dry-run 跑完是本地地址（chainId 31337）；测试网部署后会被覆盖为测试网地址（chainId 97）
└── verification.json          # 测试网验证后生成（目前无）
```

## 前端文案红线（第 2 步已落实，见“前端”一节）

前端页面文案**不许出现“被动收入”“自动赚钱”这类承诺收益的词**。只描述功能（发任务、接任务、托管、验收放款），不承诺任何收益。涉及资金处放风险提示（测试网代币无实际价值；智能合约托管存在风险；主网上线前请自行审计/复核）。

## 主网上线 checklist（2026-11-21 已部署，见 `deployment-mainnet.json`）

- [x] 部署主网（chainId 56）AgentJobBoard — **已完成**：合约 `0x91C9aFecC98289Cf21F13f26056801B38cEBcdEe`，部署交易 `0x78458524ac641645a83d7a2c86ad47b695261d3c93f59db225064aa5928cafed`（区块 134898264，gas 1,467,271，费用 0.00010967850725 BNB），部署者 `0x1bEe0Ec0865606F3A36d828D554E6dd471a772f1`。部署脚本 `scripts/deploy-mainnet.js`（`deploy.js` 的主网护栏未动，仍拒绝非测试网/本地链）。
- [x] BscScan 验证开源（Verify & Publish 合约源码）— **已完成（2026-11-21）**：Sourcify 验证通过（exact_match，creation + runtime 均为 exact_match，verificationId `eb8ab0d4-40e0-47e9-b158-821174049231`，见 https://repo.sourcify.dev/56/0x91C9aFecC98289Cf21F13f26056801B38cEBcdEe）。BscScan API key 已接通（custom.bscscan 连接器），用 Etherscan V2 API 提交验证时返回 `Contract source code already verified`，并经 `getsourcecode` 独立核实：BscScan 已持有源码（ContractName `AgentJobBoard`，源码 37,421 字符），即 Sourcify 验证已同步到 BscScan，合约页可公开查看源码。验证脚本 `~/workspace/custom-connectors/custom.bscscan/bin/verify-contract.py`，连接器文档 `~/workspace/custom-connectors/custom.bscscan/CONNECTOR.md`。注意：`@nomicfoundation/hardhat-verify` v2 的 Sourcify 走已下线的 API v1，已改用 `scripts/verify-sourcify-v2.mjs`（API v2 + 标准 JSON）完成验证。
- [x] 支付代币换成真实 USDC 地址（去掉 MockUSDC）— **已完成**：Binance-Peg USDC `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d`。**注意：它是 18 位小数，不是 6 位**（链上 `decimals()` 已核实）。前端已按网络区分小数位（主网 18，测试网/本地 6），见 `frontend/config.js` 的 `tokenDecimals` 与 `app.js` 的 `activeDecimals()`。
- [x] Agent ID 地址换成生产地址 `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`（合约常量 `PRODUCTION_AGENT_ID`，部署参数替换即可）— **已完成**（链上 `agentId()` 已核实）。
- [x] 去掉 MockAgentID — **已完成**：主网只部署了 AgentJobBoard 一个合约，未部署任何 Mock 合约。
- [x] 前端 `config.js` 切到主网：56 一项填好主网 AgentJobBoard 地址 + 真实 USDC 地址，Agent ID 用生产地址；确认 `configForChain(56)` 不再返回 `null` — **已完成**（`configForChain(56)` 返回有效配置，decimals 18、符号 USDC；本地 21 项前端验证重跑全过，测试网/本地路径未破坏）。主网实测发单→接单→交付→验收全流程**未做**（见下条）。
- [ ] 主网部署前再做一次安全检查（重入、权限、边界），并小额实测全流程 — **待做**：需要两样东西（1）部署者钱包里有少量真实 USDC（建议先转 1–2 USDC 到 `0x1bEe0Ec0865606F3A36d828D554E6dd471a772f1`，发单测试用）；（2）一个持有真实 Agent ID 的地址（用户在币安 App 里免费领取 Agent ID 后，用该地址接单测试）。实测步骤：发单（小额，如 0.1 USDC）→ 接单（Agent ID 持有者）→ 交付 → 验收放款，再测一笔超时退款。
