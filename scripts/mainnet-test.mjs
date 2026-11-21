// Mainnet poster-side flow test for AgentJobBoard (BNB Agent ID Hackathon).
// Steps: escrow lock (job 0, 0.1 USDC, 24h) -> second job (job 1, 0.1 USDC,
// 300s deadline) -> wait for deadline -> refund(job 1) -> cancelJob(job 0).
// NEVER attempts acceptJob / submitDelivery / acceptDelivery.
// Safety: each job exactly 0.1 USDC; abort if any tx would cost > 0.001 BNB;
// abort on any unexpected on-chain state. Private key is read only to build
// the signer and is never printed or logged.
import fs from "fs";
import { ethers } from "ethers";

const RPC = "https://bsc-dataseed.binance.org/";
const BOARD = "0x91C9aFecC98289Cf21F13f26056801B38cEBcdEe";
const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const WALLET_FILE = "/home/hatch/workspace/wallets/evm/ene-evm-wallet.json";
const REWARD = ethers.parseUnits("0.1", 18); // 0.1 USDC, 18 decimals
const MAX_FEE_BNB = ethers.parseEther("0.001");
const BSCSCAN = "https://bscscan.com/tx/";

const BOARD_ABI = [
  "function postJob(string title, string description, uint256 reward, uint256 reviewDeadline) returns (uint256 jobId)",
  "function refund(uint256 jobId)",
  "function cancelJob(uint256 jobId)",
  "function getJob(uint256 jobId) view returns (tuple(address poster, address worker, uint256 reward, uint256 reviewDeadline, string title, string description, string delivery, uint8 status))",
  "function nextJobId() view returns (uint256)",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

const STATUS = ["Open", "InProgress", "Delivered", "Completed", "Refunded"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assertEq(label, actual, expected) {
  if (String(actual) !== String(expected)) {
    throw new Error(`MISMATCH ${label}: got ${actual}, expected ${expected}`);
  }
  console.log(`  OK ${label} = ${actual}`);
}

const FEES = [];
async function sendTx(label, txPromiseFn) {
  const tx = await txPromiseFn();
  console.log(`  ${label} tx sent: ${tx.hash} (${BSCSCAN}${tx.hash})`);
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error(`${label} tx reverted: ${tx.hash}`);
  const fee = receipt.gasUsed * receipt.gasPrice;
  FEES.push({ label, hash: tx.hash, gasUsed: receipt.gasUsed.toString(), feeBnb: ethers.formatEther(fee) });
  console.log(`  ${label} confirmed in block ${receipt.blockNumber}, gas ${receipt.gasUsed}, fee ${ethers.formatEther(fee)} BNB`);
  if (fee > MAX_FEE_BNB) throw new Error(`${label} fee ${ethers.formatEther(fee)} BNB exceeds 0.001 BNB cap`);
  return { receipt, fee };
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
  async function job(id) {
    const j = await board.getJob(id);
    return { poster: j.poster, worker: j.worker, reward: j.reward, deadline: Number(j.reviewDeadline), status: STATUS[Number(j.status)], title: j.title };
  }

  console.log("\n== STARTING STATE ==");
  let s = await state();
  console.log("  wallet USDC:", fmtU(s.walletUsdc), "| wallet BNB:", ethers.formatEther(s.walletBnb));
  console.log("  board USDC:", fmtU(s.boardUsdc), "| nextJobId:", s.nextJobId.toString(), "| chain time:", s.chainTime);
  assertEq("wallet USDC start", fmtU(s.walletUsdc), "3.0");
  assertEq("board USDC start", fmtU(s.boardUsdc), "0.0");
  assertEq("nextJobId start", s.nextJobId.toString(), "0");

  // ---- Step 1: escrow test, job 0, 24h deadline ----
  console.log("\n== STEP 1: escrow test (approve 0.1 + postJob, deadline +24h) ==");
  const deadline1 = s.chainTime + 24 * 3600;
  await sendTx("approve #1", () => usdc.approve(BOARD, REWARD));
  assertEq("allowance after approve #1", fmtU(await usdc.allowance(wallet, BOARD)), "0.1");
  const r1 = await sendTx("postJob #1", () =>
    board.postJob("主网实测-托管", "测试：验证报酬锁定进托管", REWARD, deadline1)
  );
  const jobId0 = 0;
  const j0 = await job(jobId0);
  console.log("  job 0:", JSON.stringify({ ...j0, reward: fmtU(j0.reward) }));
  assertEq("job0 status", j0.status, "Open");
  assertEq("job0 poster", j0.poster.toLowerCase(), wallet.toLowerCase());
  assertEq("job0 reward", fmtU(j0.reward), "0.1");
  s = await state();
  assertEq("wallet USDC after job0", fmtU(s.walletUsdc), "2.9");
  assertEq("board USDC after job0", fmtU(s.boardUsdc), "0.1");
  assertEq("nextJobId after job0", s.nextJobId.toString(), "1");
  console.log("  postJob #1 hash:", r1.receipt.hash);

  // ---- Step 2: refund test, job 1, 300s deadline ----
  console.log("\n== STEP 2: refund test (approve 0.1 + postJob, deadline +300s) ==");
  s = await state();
  const deadline2 = s.chainTime + 300;
  await sendTx("approve #2", () => usdc.approve(BOARD, REWARD));
  assertEq("allowance after approve #2", fmtU(await usdc.allowance(wallet, BOARD)), "0.1");
  const r2 = await sendTx("postJob #2", () =>
    board.postJob("主网实测-退款", "测试：验证超时退款", REWARD, deadline2)
  );
  const jobId1 = 1;
  const j1 = await job(jobId1);
  console.log("  job 1:", JSON.stringify({ ...j1, reward: fmtU(j1.reward) }));
  assertEq("job1 status", j1.status, "Open");
  assertEq("job1 reward", fmtU(j1.reward), "0.1");
  s = await state();
  assertEq("wallet USDC after job1", fmtU(s.walletUsdc), "2.8");
  assertEq("board USDC after job1", fmtU(s.boardUsdc), "0.2");
  console.log("  postJob #2 hash:", r2.receipt.hash, "| deadline2:", deadline2, new Date(deadline2 * 1000).toISOString());

  // ---- Step 3: wait for deadline, then refund(job 1) ----
  console.log("\n== STEP 3: waiting for job 1 deadline to pass ==");
  while (true) {
    const t = (await provider.getBlock("latest")).timestamp;
    const left = deadline2 - t;
    console.log(`  chain time ${t}, ${left}s left`);
    if (t > deadline2) break;
    await sleep(Math.min(15000, Math.max(1000, left * 1000)));
  }
  await sleep(15000); // one extra block buffer
  const r3 = await sendTx("refund job 1", () => board.refund(jobId1));
  const j1b = await job(jobId1);
  assertEq("job1 status after refund", j1b.status, "Refunded");
  s = await state();
  assertEq("wallet USDC after refund", fmtU(s.walletUsdc), "2.9");
  assertEq("board USDC after refund", fmtU(s.boardUsdc), "0.1");
  console.log("  refund hash:", r3.receipt.hash);

  // ---- Step 4: cancel job 0, reclaim escrow ----
  console.log("\n== STEP 4: cancel job 0 (reclaim escrow) ==");
  const r4 = await sendTx("cancelJob job 0", () => board.cancelJob(jobId0));
  const j0b = await job(jobId0);
  assertEq("job0 status after cancel", j0b.status, "Refunded");
  s = await state();
  assertEq("wallet USDC final", fmtU(s.walletUsdc), "3.0");
  assertEq("board USDC final", fmtU(s.boardUsdc), "0.0");
  console.log("  cancel hash:", r4.receipt.hash);

  const totalFee = FEES.reduce((a, f) => a + BigInt(Math.round(Number(f.feeBnb) * 1e18)), 0n);
  console.log("\n== FINAL STATE ==");
  console.log("  wallet USDC:", fmtU(s.walletUsdc), "| board USDC:", fmtU(s.boardUsdc));
  console.log("  wallet BNB:", ethers.formatEther(s.walletBnb));
  console.log("  job 0:", j0b.status, "| job 1:", j1b.status);
  console.log("  tx fees (BNB):", JSON.stringify(FEES));
  console.log("  ALL CHECKS PASSED");
}

main().catch((e) => {
  console.error("TEST ABORTED:", e.message);
  process.exit(1);
});
