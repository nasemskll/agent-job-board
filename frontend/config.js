// Agent Job Board 前端配置：合约地址按 chainId 选择。
// 唯一可以写合约地址的地方是本文件；业务代码（app.js）只从这里读，
// 绝不在业务代码里写死地址。
//
// 地址来源：
// - 31337（本地 Hardhat）：复制自 deployment.localhost-dryrun.json
//   （deployedAt 2026-11-21T01:15:38Z）。本地重新部署后，地址若变化，
//   请同步更新此处，或让 loadDeploymentOverrides() 从部署文件自动覆盖
//   （见下方：静态服务器以项目根目录为根时可自动读取）。
// - 97（BSC 测试网）：已部署，地址来自 deployment.json
//   （deployedAt 2026-11-21T02:11:16Z），并经 verify-flow.js 链上验证通过。
// - 56（BSC 主网）：已上线（2026-11-21）。AgentJobBoard 已部署，
//   支付代币为真实 USDC（Binance-Peg，18 位小数），Agent ID 为生产地址。
//   部署记录见 deployment-mainnet.json。
(function (root) {
  const CONFIG = {
    // 生产 SPACE ID Agent ID（BSC 主网 chainId 56，ERC-721）。
    // 测试网（97）没有官方部署，用自部署的 MockAgentID 替身。
    productionAgentId: "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F",
    // 支付代币小数位：默认 6（MockUSDC）。各网络的实际值见 networks 里的
    // tokenDecimals：本地/测试网 6（MockUSDC），主网 18（Binance-Peg USDC）。
    // app.js 一律用当前网络的 tokenDecimals，不要直接读这个默认值。
    tokenDecimals: 6,
    networks: {
      31337: {
        label: "本地 Hardhat（31337）",
        rpc: "http://127.0.0.1:8545",
        explorer: "",
        tokenDecimals: 6,
        tokenSymbol: "mUSDC",
        contracts: {
          MockUSDC: "0xAc575B03E5774a946d86F5476D2A0cec7E5D0a06",
          MockAgentID: "0x35eF9EFBA3162812e8553ba2f0A8C716b071faA7",
          AgentJobBoard: "0x64F25291af60ccF1c155282f558B50FeCC9E8daf",
        },
      },
      97: {
        label: "BSC 测试网（97）",
        rpc: "https://data-seed-prebsc-1-s1.binance.org:8545/",
        explorer: "https://testnet.bscscan.com",
        tokenDecimals: 6,
        tokenSymbol: "mUSDC",
        contracts: {
          // 测试网已部署（2026-11-21），地址与 deployment.json 一致。
          MockUSDC: "0xAc575B03E5774a946d86F5476D2A0cec7E5D0a06",
          MockAgentID: "0x35eF9EFBA3162812e8553ba2f0A8C716b071faA7",
          AgentJobBoard: "0x64F25291af60ccF1c155282f558B50FeCC9E8daf",
        },
      },
      56: {
        label: "BSC 主网（56）",
        rpc: "https://bsc-dataseed.binance.org/",
        explorer: "https://bscscan.com",
        // 主网支付代币是 Binance-Peg USDC（18 位小数），不是 6 位！
        // 前端按此处的 tokenDecimals 解析/展示金额，勿改回 6。
        tokenDecimals: 18,
        tokenSymbol: "USDC",
        contracts: {
          // 主网已部署（2026-11-21），地址见 deployment-mainnet.json。
          // AgentJobBoard 部署交易：
          // 0x78458524ac641645a83d7a2c86ad47b695261d3c93f59db225064aa5928cafed
          MockUSDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", // 真实 USDC（Binance-Peg，18 位）
          MockAgentID: "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F",
          AgentJobBoard: "0x91C9aFecC98289Cf21F13f26056801B38cEBcdEe",
        },
      },
    },
  };

  // 尝试从项目根目录的部署文件自动覆盖地址（仅当文件里的 chainId
  // 与配置项一致时才覆盖，避免测试网/本地地址串用）。
  // 静态服务器以项目根目录为根时生效；只以 frontend/ 为根时 fetch
  // 会 404，静默回落到上面写死的地址，不影响使用。
  async function loadDeploymentOverrides() {
    if (typeof fetch === "undefined") return CONFIG;
    const files = ["deployment.localhost-dryrun.json", "deployment.json"];
    for (const file of files) {
      try {
        const res = await fetch("../" + file);
        if (!res.ok) continue;
        const dep = await res.json();
        const net = CONFIG.networks[dep.chainId];
        if (!net || !dep.contracts) continue;
        for (const k of ["MockUSDC", "MockAgentID", "AgentJobBoard"]) {
          if (dep.contracts[k]) net.contracts[k] = dep.contracts[k];
        }
      } catch (e) {
        // 部署文件不存在或读不到：用内置地址，忽略错误。
      }
    }
    return CONFIG;
  }

  // 返回指定链的配置；地址不全或链不在表里时返回 null（前端据此提示不支持）。
  function configForChain(chainId) {
    const net = CONFIG.networks[Number(chainId)];
    if (!net) return null;
    const c = net.contracts;
    if (!c.MockUSDC || !c.MockAgentID || !c.AgentJobBoard) return null;
    return { chainId: Number(chainId), ...net };
  }

  const api = { CONFIG, configForChain, loadDeploymentOverrides };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.APP_CONFIG = api;
})(typeof window !== "undefined" ? window : globalThis);
