// Full-flow verification against a DEPLOYED board on BSC Testnet (chainId 97).
//   npx hardhat run scripts/verify-flow.js --network bsctestnet
// Reads deployment.json + test-wallets.json. Runs:
//   (a) post -> accept -> deliver -> accept -> payout (worker balance +reward)
//   (b) short-deadline job -> wait past deadline -> refund (poster balance back)
//   (c) negative: address WITHOUT an Agent ID must fail acceptJob
// Prints every tx hash and balance check; writes verification.json.
// No mainnet, no real money, no new accounts.
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const hre = require("hardhat");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  if (Number(network.chainId) !== 97) {
    throw new Error(`Refusing: chainId ${network.chainId} is not BSC Testnet (97).`);
  }
  const root = path.join(__dirname, "..");
  const deployment = JSON.parse(fs.readFileSync(path.join(root, "deployment.json"), "utf8"));
  const wallets = JSON.parse(fs.readFileSync(path.join(root, "test-wallets.json"), "utf8"));
  const provider = hre.ethers.provider;

  const poster = new hre.ethers.Wallet(wallets.poster.privateKey, provider);
  const worker = new hre.ethers.Wallet(wallets.worker.privateKey, provider);
  const stranger = hre.ethers.Wallet.createRandom().connect(provider); // no Agent ID, no funds needed (revert happens before gas-heavy work; needs a little tBNB — funded below if possible)
  const deployer = new hre.ethers.Wallet(wallets.deployer.privateKey, provider);

  const usdc = await hre.ethers.getContractAt("MockUSDC", deployment.contracts.MockUSDC);
  const agentId = await hre.ethers.getContractAt("MockAgentID", deployment.contracts.MockAgentID);
  const board = await hre.ethers.getContractAt("AgentJobBoard", deployment.contracts.AgentJobBoard);
  const boardPoster = board.connect(poster);
  const boardWorker = board.connect(worker);

  const results = { network: "BSC Testnet", chainId: 97, checks: [] };
  const check = (name, ok, detail) => {
    results.checks.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail || ""}`);
    if (!ok) throw new Error(`Check failed: ${name}`);
  };
  const bal = (a) => usdc.balanceOf(a);
  const chainNow = async () => (await provider.getBlock("latest")).timestamp;

  // Fund the stranger with a dust of tBNB so its (reverting) accept tx can be sent.
  const fundStranger = await deployer.sendTransaction({ to: stranger.address, value: ethers.parseEther("0.01") });
  await fundStranger.wait();

  // ---------- (a) happy path ----------
  console.log("\n== (a) post -> accept -> deliver -> accept -> payout ==");
  const reward = 100n * 10n ** 6n; // 100 mUSDC
  const workerBefore = await bal(worker.address);
  const posterBefore = await bal(poster.address);
  const deadline = (await chainNow()) + 3600;

  await (await usdc.connect(poster).approve(await board.getAddress(), reward)).wait();
  const postTx = await boardPoster.postJob("Test task: write a short research note", "Deliverable: a 500-word note + sources.", reward, deadline);
  const postRc = await postTx.wait();
  const jobId = 0n; // first job on a fresh board; read from event to be safe
  const parsed = postRc.logs.map((l) => { try { return board.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "JobPosted");
  const jobIdA = parsed ? parsed.args.jobId : jobId;
  console.log("postJob tx:", postTx.hash, "jobId:", jobIdA.toString());

  const acceptTx = await boardWorker.acceptJob(jobIdA);
  await acceptTx.wait();
  console.log("acceptJob tx:", acceptTx.hash);

  const deliverTx = await boardWorker.submitDelivery(jobIdA, "ipfs://QmTestDeliveryHashA");
  await deliverTx.wait();
  console.log("submitDelivery tx:", deliverTx.hash);

  const acceptDeliveryTx = await boardPoster.acceptDelivery(jobIdA);
  await acceptDeliveryTx.wait();
  console.log("acceptDelivery tx:", acceptDeliveryTx.hash);

  const workerAfter = await bal(worker.address);
  const posterAfter = await bal(poster.address);
  check("worker balance increased by exactly the reward",
    workerAfter - workerBefore === reward,
    `worker ${ethers.formatUnits(workerBefore, 6)} -> ${ethers.formatUnits(workerAfter, 6)} mUSDC`);
  check("poster balance decreased by exactly the reward",
    posterBefore - posterAfter === reward,
    `poster ${ethers.formatUnits(posterBefore, 6)} -> ${ethers.formatUnits(posterAfter, 6)} mUSDC`);
  const jobA = await board.getJob(jobIdA);
  check("job A status is Completed", jobA.status === 3n, `status=${jobA.status}`);
  results.jobA = { jobId: jobIdA.toString(), txs: { post: postTx.hash, accept: acceptTx.hash, deliver: deliverTx.hash, acceptDelivery: acceptDeliveryTx.hash } };

  // ---------- (c) negative: no Agent ID ----------
  console.log("\n== (c) negative: acceptJob without Agent ID must revert ==");
  const rewardB = 10n * 10n ** 6n;
  const deadlineB = (await chainNow()) + 3600;
  await (await usdc.connect(poster).approve(await board.getAddress(), rewardB)).wait();
  const postTxB = await boardPoster.postJob("Negative-test job", "Only for the no-Agent-ID check.", rewardB, deadlineB);
  const postRcB = await postTxB.wait();
  const parsedB = postRcB.logs.map((l) => { try { return board.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "JobPosted");
  const jobIdB = parsedB.args.jobId;
  console.log("postJob (neg test) tx:", postTxB.hash, "jobId:", jobIdB.toString());

  let reverted = false;
  try {
    const tx = await board.connect(stranger).acceptJob(jobIdB);
    await tx.wait();
  } catch (e) {
    reverted = true;
    console.log("acceptJob reverted as expected:", String(e.message).slice(0, 160));
  }
  check("acceptJob without Agent ID reverts", reverted);
  const strangerBal = await agentId.balanceOf(stranger.address);
  check("stranger indeed holds 0 Agent ID", strangerBal === 0n, `balanceOf=${strangerBal}`);
  results.jobNeg = { jobId: jobIdB.toString(), postTx: postTxB.hash };

  // ---------- (b) timeout refund ----------
  console.log("\n== (b) short-deadline job -> refund after deadline ==");
  const rewardC = 50n * 10n ** 6n;
  const deadlineC = (await chainNow()) + 60; // 60s deadline
  await (await usdc.connect(poster).approve(await board.getAddress(), rewardC)).wait();
  const postTxC = await boardPoster.postJob("Short-deadline job", "Expires in 60s for refund test.", rewardC, deadlineC);
  const postRcC = await postTxC.wait();
  const parsedC = postRcC.logs.map((l) => { try { return board.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "JobPosted");
  const jobIdC = parsedC.args.jobId;
  console.log("postJob (refund test) tx:", postTxC.hash, "jobId:", jobIdC.toString(), "deadline in 60s");
  // Balance AFTER posting: reward is locked in escrow, so refund must add it back.
  const posterBeforeC = await bal(poster.address);
  console.log("Waiting 75s for the deadline to pass...");
  await sleep(75_000);
  const refundTx = await boardWorker.refund(jobIdC); // worker triggers it
  await refundTx.wait();
  console.log("refund tx:", refundTx.hash);
  const posterAfterC = await bal(poster.address);
  check("poster balance restored by exactly the reward after refund",
    posterAfterC - posterBeforeC === rewardC,
    `poster ${ethers.formatUnits(posterBeforeC, 6)} -> ${ethers.formatUnits(posterAfterC, 6)} mUSDC`);
  const jobC = await board.getJob(jobIdC);
  check("job C status is Refunded", jobC.status === 4n, `status=${jobC.status}`);
  results.jobRefund = { jobId: jobIdC.toString(), txs: { post: postTxC.hash, refund: refundTx.hash } };

  results.allPassed = results.checks.every((c) => c.ok);
  results.verifiedAt = new Date().toISOString();
  fs.writeFileSync(path.join(root, "verification.json"), JSON.stringify(results, null, 2));
  console.log("\nALL CHECKS PASSED. Wrote verification.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
