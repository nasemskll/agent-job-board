// Worker-side flow test, part 3: acceptDelivery for job 2 from ENE's EVM wallet.
// Run ONLY after the worker has done acceptJob + submitDelivery via baw.
// Verifies job 2 is Delivered by the worker, then calls acceptDelivery and
// verifies final state: job Completed, worker +0.1 USDC, poster 2.9, board 0.0.
// Private key is read only to build the signer and is never printed or logged.
import fs from "fs";
import { ethers } from "ethers";

const RPC = "https://bsc-dataseed.binance.org/";
const BOARD = "0x91C9aFecC98289Cf21F13f26056801B38cEBcdEe";
const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const WALLET_FILE = "/home/hatch/workspace/wallets/evm/ene-evm-wallet.json";
const WORKER = "0xba0b36da8e0ec5579b156cf5dcdc9b2299f719b9";
const MAX_FEE_BNB = ethers.parseEther("0.001");
const BSCSCAN = "https://bscscan.com/tx/";
const JOB_ID = 2;

const BOARD_ABI = [
  "function acceptDelivery(uint256 jobId)",
  "function getJob(uint256 jobId) view returns (tuple(address poster, address worker, uint256 reward, uint256 reviewDeadline, string title, string description, string delivery, uint8 status))",
];
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];

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
  if (wallet.toLowerCase() !== "0x1bee0ec0865606f3a36d828d554e6dd471a772f1") {
    throw new Error("signer is not ENE's EVM wallet, aborting");
  }
  const chainId = (await provider.getNetwork()).chainId;
  if (chainId !== 56n) throw new Error(`wrong chain ${chainId}, aborting`);
  const usdc = new ethers.Contract(USDC, ERC20_ABI, provider);
  const board = new ethers.Contract(BOARD, BOARD_ABI, signer);
  const fmtU = (v) => ethers.formatUnits(v, 18);

  console.log("\n== PRE-ACCEPT STATE ==");
  const j = await board.getJob(JOB_ID);
  console.log("  job 2:", JSON.stringify({
    poster: j.poster, worker: j.worker, reward: fmtU(j.reward),
    delivery: j.delivery, status: STATUS[Number(j.status)],
  }));
  assertEq("job2 status before accept", STATUS[Number(j.status)], "Delivered");
  assertEq("job2 worker", j.worker.toLowerCase(), WORKER.toLowerCase());
  assertEq("job2 poster", j.poster.toLowerCase(), wallet.toLowerCase());
  if (!j.delivery) throw new Error("job2 delivery is empty");
  const workerUsdcBefore = await usdc.balanceOf(WORKER);
  console.log("  worker USDC before:", fmtU(workerUsdcBefore));
  assertEq("worker USDC before", fmtU(workerUsdcBefore), "0.0");

  console.log("\n== ACCEPT DELIVERY ==");
  const tx = await board.acceptDelivery(JOB_ID);
  console.log("  acceptDelivery tx:", tx.hash, `(${BSCSCAN}${tx.hash})`);
  const r = await tx.wait();
  if (r.status !== 1) throw new Error("acceptDelivery reverted");
  const fee = r.gasUsed * r.gasPrice;
  console.log("  confirmed block", r.blockNumber, "fee", ethers.formatEther(fee), "BNB");
  if (fee > MAX_FEE_BNB) throw new Error("acceptDelivery fee exceeds 0.001 BNB cap");

  console.log("\n== FINAL STATE ==");
  const j2 = await board.getJob(JOB_ID);
  assertEq("job2 status final", STATUS[Number(j2.status)], "Completed");
  assertEq("worker USDC final", fmtU(await usdc.balanceOf(WORKER)), "0.1");
  assertEq("poster USDC final", fmtU(await usdc.balanceOf(wallet)), "2.9");
  assertEq("board USDC final", fmtU(await usdc.balanceOf(BOARD)), "0.0");
  console.log("  poster BNB:", ethers.formatEther(await provider.getBalance(wallet)));
  console.log("  worker BNB:", ethers.formatEther(await provider.getBalance(WORKER)));
  console.log("\n  WORKER FLOW COMPLETE — job 2 Completed, worker paid 0.1 USDC");
}

main().catch((e) => {
  console.error("TEST ABORTED:", e.message);
  process.exit(1);
});
