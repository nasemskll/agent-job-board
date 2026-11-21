require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-verify");
const fs = require("fs");
const path = require("path");

// Test wallets live ONLY in test-wallets.json (chmod 600, gitignored).
// Never paste a private key into code, README or reports.
function loadTestWallets() {
  const p = path.join(__dirname, "test-wallets.json");
  if (!fs.existsSync(p)) return [];
  const w = JSON.parse(fs.readFileSync(p, "utf8"));
  return [w.deployer.privateKey, w.poster.privateKey, w.worker.privateKey]
    .filter(Boolean);
}

// ENE's EVM wallet (mainnet deployer). Key lives ONLY in
// ~/workspace/wallets/evm/ene-evm-wallet.json (chmod 600).
// Never paste a private key into code, README or reports.
function loadEneWallet() {
  const p = path.join(__dirname, "..", "..", "wallets", "evm", "ene-evm-wallet.json");
  if (!fs.existsSync(p)) return [];
  const w = JSON.parse(fs.readFileSync(p, "utf8"));
  return [w.privateKey].filter(Boolean);
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  // Sourcify verification needs no API key. BscScan-native verification
  // (npx hardhat verify) needs a free BscScan API key — see README.
  // Etherscan verifier is disabled until that key exists.
  etherscan: {
    enabled: false,
  },
  sourcify: {
    enabled: true,
  },
  networks: {
    hardhat: { chainId: 31337 },
    bsctestnet: {
      // BSC Testnet (Chapel), chainId 97. TESTNET ONLY — never mainnet.
      url: "https://data-seed-prebsc-1-s1.binance.org:8545/",
      chainId: 97,
      accounts: loadTestWallets(),
    },
    bscmainnet: {
      // BSC Mainnet, chainId 56. REAL MONEY — deploys spend BNB gas.
      // Only scripts/deploy-mainnet.js may use this network; deploy.js
      // refuses any chainId other than 97/31337/localhost.
      url: "https://bsc-dataseed.binance.org/",
      chainId: 56,
      accounts: loadEneWallet(),
    },
  },
};
