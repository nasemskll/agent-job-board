// Worker-side flow test, part 1: post job 2 from ENE's EVM wallet.
// Steps: approve 0.1 USDC + postJob(title, description, 0.1 USDC, deadline +1h).
// Verifies on-chain state at each step; aborts on any mismatch.
// Does NOT touch acceptJob / submitDelivery / acceptDelivery.
// Private key is read only to build the signer and is never printed or logged.
import fs from "fs";
import { ethers } from "ethers";

const RPC = "https://bsc-dataseed.binance.org/";
const BOARD = "0x91C9aFecC98289Cf21F13f26056801B38cEBcdEe";
const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const WALLET_FILE = "/home/hatch/workspace/wallets/evm/ene-evm-wallet.json";
const REWARD = ethers.parseUnits("0.1", 18); // 0.1 USDC, 18 decimals
const MAX_FEE_BNB = ethers.parseEther("0.001");
const BSCSCAN = "https://bscscan.com/tx/";
const JOB_ID = 2;

const BOARD_ABI = [
  "function postJob(string title, string description, uint256 reward, uint256 reviewDeadline) returns (uint256 jobId)",
  "function acceptDelivery(uint256 jobId)",
  "function getJob(uint256 jobId) view returns (tuple(address poster, address worker, uint256 reward, uint256 reviewDeadline, string title, string description, string delivery, uint8 status))",
  "function nextJobId() view returns (uint256)",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

const STATUS = ["Open", "InProgress", "Delivered", "Completed", "Refunded"];

function assertEq(label, actual, expected) {
  if (String(actual) !== String(expected)) {
    throw new Error(`MISMATCH ${label}: got ${actual}, expected ${expected}`);
  }
  console.log(`  OK ${label} = ${actual}`);
}

async function main() {
  const keyData = JSON.parse(fs.readFileSync(WALLET_FILE, "utf8"));
  const provider = new ethers.JsonRpcProvider(RPC);
  const signer = new ethers.Wallet(keyData.privateKey, provider);
  const wallet = await signer.getAddress();
  console.log("poster:", wallet);
  if (wallet.toLowerCase() !== "0x1bee0ec0865606f3a36d828d554e6dd471a772f1") {
    throw new Error("signer is not ENE's EVM wallet, aborting");
  }
  const chainId = (await provider.getNetwork()).chainId;
  if (chainId !== 56n) throw new Error(`wrong chain ${chainId}, aborting`);
  const usdc = new ethers.Contract(USDC, ERC20_ABI, signer);
  const board = new ethers.Contract(BOARD, BOARD_ABI, signer);
  const fmtU = (v) => ethers.formatUnits(v, 18);

  async function state() {
    return {
      walletUsdc: await usdc.balanceOf(wallet),
      walletBnb: await provider.getBalance(wallet),
      boardUsdc: await usdc.balanceOf(BOARD),
      nextJobId: await board.nextJobId(),
      chainTime: (await provider.getBlock("latest")).timestamp,
    };
  }

  console.log("\n== STARTING STATE ==");
  let s = await state();
  console.log("  wallet USDC:", fmtU(s.walletUsdc), "| wallet BNB:", ethers.formatEther(s.walletBnb));
  console.log("  board USDC:", fmtU(s.boardUsdc), "| nextJobId:", s.nextJobId.toString(), "| chain time:", s.chainTime);
  assertEq("wallet USDC start", fmtU(s.walletUsdc), "3.0");
  assertEq("board USDC start", fmtU(s.boardUsdc), "0.0");
  assertEq("nextJobId start", s.nextJobId.toString(), "2");

  console.log("\n== POST JOB 2 (approve 0.1 + postJob, deadline +1h) ==");
  const deadline = s.chainTime + 3600;
  const txA = await usdc.approve(BOARD, REWARD);
  console.log("  approve tx:", txA.hash, `(${BSCSCAN}${txA.hash})`);
  const rA = await txA.wait();
  if (rA.status !== 1) throw new Error("approve reverted");
  console.log("  approve confirmed block", rA.blockNumber, "fee", ethers.formatEther(rA.gasUsed * rA.gasPrice), "BNB");
  assertEq("allowance after approve", fmtU(await usdc.allowance(wallet, BOARD)), "0.1");

  const txP = await board.postJob(
    "接单全流程测试",
    "测试：Agent ID 持有者接单-交付-验收全流程（job 2）",
    REWARD,
    deadline
  );
  console.log("  postJob tx:", txP.hash, `(${BSCSCAN}${txP.hash})`);
  const rP = await txP.wait();
  if (rP.status !== 1) throw new Error("postJob reverted");
  const feeP = rP.gasUsed * rP.gasPrice;
  console.log("  postJob confirmed block", rP.blockNumber, "fee", ethers.formatEther(feeP), "BNB");
  if (feeP > MAX_FEE_BNB) throw new Error("postJob fee exceeds 0.001 BNB cap");

  const j = await board.getJob(JOB_ID);
  console.log("  job 2:", JSON.stringify({
    poster: j.poster, worker: j.worker, reward: fmtU(j.reward),
    deadline: Number(j.reviewDeadline), status: STATUS[Number(j.status)], title: j.title,
  }));
  assertEq("job2 status", STATUS[Number(j.status)], "Open");
  assertEq("job2 poster", j.poster.toLowerCase(), wallet.toLowerCase());
  assertEq("job2 reward", fmtU(j.reward), "0.1");
  assertEq("job2 deadline", Number(j.reviewDeadline), deadline);

  s = await state();
  assertEq("wallet USDC after post", fmtU(s.walletUsdc), "2.9");
  assertEq("board USDC after post", fmtU(s.boardUsdc), "0.1");
  assertEq("nextJobId after post", s.nextJobId.toString(), "3");
  console.log("\n  deadline:", deadline, new Date(deadline * 1000).toISOString());
  console.log("  JOB 2 POSTED — waiting for worker (acceptJob) via baw");
}

main().catch((e) => {
  console.error("TEST ABORTED:", e.message);
  process.exit(1);
});
