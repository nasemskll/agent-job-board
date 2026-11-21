// 从 Hardhat 编译产物生成 frontend/abi.js（只含前端用到的函数与事件）。
// 合约重编后重新跑：node scripts/generate-frontend-abi.js
// 目的：前端 ABI 与链上合约保持一致，避免手抄 ABI 出错。
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const load = (p) => require(path.join(root, p)).abi;
const board = load("artifacts/contracts/AgentJobBoard.sol/AgentJobBoard.json");
const usdc = load("artifacts/contracts/MockUSDC.sol/MockUSDC.json");
const agent = load("artifacts/contracts/MockAgentID.sol/MockAgentID.json");

const pick = (abi, names) => abi.filter((f) => names.includes(f.name));
const boardAbi = pick(board, [
  "nextJobId", "getJob", "jobs", "postJob", "acceptJob", "submitDelivery",
  "acceptDelivery", "rejectDelivery", "refund", "cancelJob",
  "paymentToken", "agentId",
]);
const usdcAbi = pick(usdc, ["approve", "allowance", "balanceOf", "decimals", "symbol", "name"]);
const agentAbi = pick(agent, ["balanceOf"]);
const events = board.filter(
  (f) => f.type === "event" && ["JobPosted", "JobCancelled", "JobRefunded"].includes(f.name)
);

const abi = { board: [...boardAbi, ...events], usdc: usdcAbi, agentId: agentAbi };
const out =
  "// ABI 由编译产物自动生成，勿手改。\n" +
  "// 来源：artifacts/contracts/{AgentJobBoard,MockUSDC,MockAgentID}.sol/*.json\n" +
  "// 生成命令：node scripts/generate-frontend-abi.js；合约重编后重新生成。\n" +
  "(function (root) {\n  const ABI = " +
  JSON.stringify(abi, null, 2) +
  ";\n" +
  '  if (typeof module !== "undefined" && module.exports) module.exports = ABI;\n' +
  "  root.APP_ABI = ABI;\n" +
  '})(typeof window !== "undefined" ? window : globalThis);\n';

fs.writeFileSync(path.join(root, "frontend", "abi.js"), out);
console.log("wrote frontend/abi.js");
