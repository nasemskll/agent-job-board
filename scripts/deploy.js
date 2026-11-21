// Deploy to BSC Testnet (chainId 97) ONLY.
//   npx hardhat run scripts/deploy.js --network bsctestnet
// Writes deployment.json. Funds the poster with MockUSDC and mints one
// MockAgentID to the worker. Requires test-wallets.json (see generate-wallets.js)
// and tBNB on the deployer address for gas (faucet: testnet.bnbchain.org).
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const hre = require("hardhat");

async function main() {
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;
  if (Number(chainId) !== 97 && hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    throw new Error(`Refusing to deploy: chainId ${chainId} is not BSC Testnet (97).`);
  }

  const wallets = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "test-wallets.json"), "utf8"));
  const provider = hre.ethers.provider;
  const deployer = new hre.ethers.Wallet(wallets.deployer.privateKey, provider);
  const poster = new hre.ethers.Wallet(wallets.poster.privateKey, provider);
  const worker = new hre.ethers.Wallet(wallets.worker.privateKey, provider);

  const bal = await provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address, "tBNB:", ethers.formatEther(bal));
  if (bal === 0n) {
    throw new Error("Deployer has 0 tBNB. Claim from https://testnet.bnbchain.org/faucet-smart first (captcha required).");
  }

  console.log("Deploying MockUSDC...");
  const MockUSDC = await hre.ethers.getContractFactory("MockUSDC", deployer);
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  const usdcAddr = await usdc.getAddress();
  console.log("MockUSDC:", usdcAddr, "tx:", usdc.deploymentTransaction().hash);

  console.log("Deploying MockAgentID...");
  const MockAgentID = await hre.ethers.getContractFactory("MockAgentID", deployer);
  const agentId = await MockAgentID.deploy();
  await agentId.waitForDeployment();
  const agentIdAddr = await agentId.getAddress();
  console.log("MockAgentID:", agentIdAddr, "tx:", agentId.deploymentTransaction().hash);

  console.log("Deploying AgentJobBoard...");
  const Board = await hre.ethers.getContractFactory("AgentJobBoard", deployer);
  const board = await Board.deploy(usdcAddr, agentIdAddr);
  await board.waitForDeployment();
  const boardAddr = await board.getAddress();
  console.log("AgentJobBoard:", boardAddr, "tx:", board.deploymentTransaction().hash);

  // Fund poster with 10,000 mUSDC (6 decimals) for testing.
  const fundTx = await usdc.transfer(poster.address, 10_000n * 10n ** 6n);
  await fundTx.wait();
  console.log("Funded poster with 10,000 mUSDC. tx:", fundTx.hash);

  // Mint one mock Agent ID to the worker.
  const mintTx = await agentId.mint(worker.address);
  const mintRc = await mintTx.wait();
  console.log("Minted MockAgentID #1 to worker. tx:", mintTx.hash);

  // Fund poster + worker with a little tBNB for gas (from deployer).
  for (const w of [poster, worker]) {
    const tx = await deployer.sendTransaction({ to: w.address, value: ethers.parseEther("0.05") });
    await tx.wait();
    console.log("Sent 0.05 tBNB gas to", w.address, "tx:", tx.hash);
  }

  const deployment = {
    network: hre.network.name === "localhost" ? "Local Hardhat node (dry run)" : "BSC Testnet",
    chainId: Number(chainId),
    rpc: hre.network.name === "localhost" ? "http://127.0.0.1:8545" : "https://data-seed-prebsc-1-s1.binance.org:8545/",
    explorer: hre.network.name === "localhost" ? "(local node, no explorer)" : "https://testnet.bscscan.com",
    deployer: deployer.address,
    poster: poster.address,
    worker: worker.address,
    contracts: {
      MockUSDC: usdcAddr,
      MockAgentID: agentIdAddr,
      AgentJobBoard: boardAddr,
    },
    productionAgentId: "0x60b9262456de011f7d15a54cdd8c48baaa8b022f",
    notes: "MockUSDC/MockAgentID are testnet-only stand-ins. Mainnet: real USDC + production Agent ID above.",
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(__dirname, "..", "deployment.json"), JSON.stringify(deployment, null, 2));
  console.log("Wrote deployment.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
