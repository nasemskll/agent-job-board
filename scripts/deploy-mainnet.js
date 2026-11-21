// Deploy AgentJobBoard to BSC Mainnet (chainId 56) ONLY.
//   npx hardhat run scripts/deploy-mainnet.js --network bscmainnet
// REAL MONEY: spends BNB gas from ENE's EVM wallet. Deploys ONLY
// AgentJobBoard with the real USDC + production Agent ID.
// MockUSDC/MockAgentID are testnet-only and are NEVER deployed here.
// Writes deployment-mainnet.json (does NOT touch deployment.json).
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const hre = require("hardhat");

// ---- Parameters (verified against the task brief before sending) ----
const EXPECTED_DEPLOYER = "0x1bEe0Ec0865606F3A36d828D554E6dd471a772f1";
const PAYMENT_TOKEN = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"; // Binance-Peg USDC, 18 decimals
const AGENT_ID = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F"; // SPACE ID production Agent ID
const MIN_BALANCE_BNB = "0.005";
const MAX_TOTAL_COST_BNB = "0.008";

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  console.log("Network:", hre.network.name, "chainId:", chainId);
  if (chainId !== 56 || hre.network.name !== "bscmainnet") {
    throw new Error(`Refusing to deploy: expected BSC Mainnet (56/bscmainnet), got chainId ${chainId} on ${hre.network.name}.`);
  }

  // Checksum-validate the two constructor arguments.
  const paymentToken = ethers.getAddress(PAYMENT_TOKEN);
  const agentId = ethers.getAddress(AGENT_ID);
  console.log("Payment token (Binance-Peg USDC, 18 decimals):", paymentToken);
  console.log("Agent ID (production SPACE ID):", agentId);

  const signers = await hre.ethers.getSigners();
  if (!signers.length) throw new Error("No deployer account configured for bscmainnet.");
  const deployer = signers[0];
  console.log("Deployer:", deployer.address);
  if (deployer.address.toLowerCase() !== EXPECTED_DEPLOYER.toLowerCase()) {
    throw new Error(`Refusing to deploy: deployer ${deployer.address} != expected ${EXPECTED_DEPLOYER}.`);
  }

  const balBefore = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance before:", ethers.formatEther(balBefore), "BNB");
  if (balBefore < ethers.parseEther(MIN_BALANCE_BNB)) {
    throw new Error(`Refusing to deploy: balance ${ethers.formatEther(balBefore)} BNB < required ${MIN_BALANCE_BNB} BNB.`);
  }

  // Estimate the deployment cost BEFORE sending anything.
  const Board = await hre.ethers.getContractFactory("AgentJobBoard", deployer);
  const deployTx = await Board.getDeployTransaction(paymentToken, agentId);
  const gasEstimate = await hre.ethers.provider.estimateGas({ ...deployTx, from: deployer.address });
  const feeData = await hre.ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas;
  if (!gasPrice) throw new Error("Could not read gas price.");
  const estCost = gasEstimate * gasPrice;
  console.log("Estimated gas:", gasEstimate.toString());
  console.log("Gas price:", ethers.formatUnits(gasPrice, "gwei"), "gwei");
  console.log("Estimated deploy cost:", ethers.formatEther(estCost), "BNB");
  if (estCost > ethers.parseEther(MAX_TOTAL_COST_BNB)) {
    throw new Error(`Refusing to deploy: estimated cost ${ethers.formatEther(estCost)} BNB > budget ${MAX_TOTAL_COST_BNB} BNB.`);
  }
  if (balBefore - estCost < ethers.parseEther("0.002")) {
    throw new Error("Refusing to deploy: balance after deploy would fall below 0.002 BNB buffer.");
  }

  console.log("Deploying AgentJobBoard to BSC Mainnet...");
  const board = await Board.deploy(paymentToken, agentId);
  const deployTxObj = board.deploymentTransaction();
  console.log("Deploy tx submitted:", deployTxObj.hash);
  await board.waitForDeployment();
  const boardAddr = await board.getAddress();
  console.log("AgentJobBoard:", boardAddr);

  const receipt = await deployTxObj.wait();
  const gasUsed = receipt.gasUsed;
  const actualCost = gasUsed * (receipt.gasPrice ?? gasPrice);
  console.log("Gas used:", gasUsed.toString());
  console.log("Actual deploy cost:", ethers.formatEther(actualCost), "BNB");

  const balAfter = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance after:", ethers.formatEther(balAfter), "BNB");

  const deployment = {
    network: "BSC Mainnet",
    chainId: 56,
    rpc: "https://bsc-dataseed.binance.org/",
    explorer: "https://bscscan.com",
    deployer: deployer.address,
    contracts: {
      USDC: paymentToken,
      AgentID: agentId,
      AgentJobBoard: boardAddr,
    },
    paymentTokenDecimals: 18,
    deployTxHash: deployTxObj.hash,
    gasUsed: gasUsed.toString(),
    deployCostBNB: ethers.formatEther(actualCost),
    deployerBalanceAfterBNB: ethers.formatEther(balAfter),
    productionAgentId: agentId,
    notes: "Mainnet deployment. Payment token is Binance-Peg USDC (18 decimals). No Mock contracts deployed.",
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(__dirname, "..", "deployment-mainnet.json"), JSON.stringify(deployment, null, 2));
  console.log("Wrote deployment-mainnet.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
