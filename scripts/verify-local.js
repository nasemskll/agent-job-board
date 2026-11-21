// LOCAL DRY-RUN ONLY: full-flow verification against a local deployment.
// Mirrors scripts/verify-flow.js (testnet) but runs on chainId 31337 and
// uses evm_increaseTime instead of a real 75s wait for the refund branch.
//   npx hardhat node --port 8545
//   npx hardhat run scripts/fund-local.js --network localhost
//   npx hardhat run scripts/deploy.js --network localhost
//   npx hardhat run scripts/verify-local.js --network localhost
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const net = await hre.ethers.provider.getNetwork();
  if (Number(net.chainId) !== 31337) throw new Error("Local dry-run only (chainId 31337).");
  const root = path.join(__dirname, "..");
  const deployment = JSON.parse(fs.readFileSync(path.join(root, "deployment.json"), "utf8"));
  const wallets = JSON.parse(fs.readFileSync(path.join(root, "test-wallets.json"), "utf8"));
  const provider = hre.ethers.provider;
  const poster = new hre.ethers.Wallet(wallets.poster.privateKey, provider);
  const worker = new hre.ethers.Wallet(wallets.worker.privateKey, provider);
  const stranger = (await hre.ethers.getSigners())[5]; // no Agent ID

  const usdc = await hre.ethers.getContractAt("MockUSDC", deployment.contracts.MockUSDC);
  const agentId = await hre.ethers.getContractAt("MockAgentID", deployment.contracts.MockAgentID);
  const board = await hre.ethers.getContractAt("AgentJobBoard", deployment.contracts.AgentJobBoard);
  const boardPoster = board.connect(poster);
  const boardWorker = board.connect(worker);
  const results = { network: "Local Hardhat node (dry run)", chainId: 31337, checks: [] };
  const check = (name, ok, detail) => {
    results.checks.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail || ""}`);
    if (!ok) throw new Error(`Check failed: ${name}`);
  };
  const bal = (a) => usdc.balanceOf(a);
  const chainNow = async () => (await provider.getBlock("latest")).timestamp;
  const jobIdOf = (rc) => {
    const e = rc.logs.map((l) => { try { return board.interface.parseLog(l); } catch { return null; } })
      .find((x) => x && x.name === "JobPosted");
    return e.args.jobId;
  };

  console.log("\n== (a) post -> accept -> deliver -> accept -> payout ==");
  const reward = 100n * 10n ** 6n;
  const wBefore = await bal(worker.address);
  const pBefore = await bal(poster.address);
  await (await usdc.connect(poster).approve(await board.getAddress(), reward)).wait();
  const dl = (await chainNow()) + 3600;
  const tx1 = await boardPoster.postJob("Dry-run task: write a short research note", "Deliverable: 500-word note + sources.", reward, dl);
  const jobA = jobIdOf(await tx1.wait());
  console.log("postJob tx:", tx1.hash, "jobId:", jobA.toString());
  const tx2 = await boardWorker.acceptJob(jobA); await tx2.wait();
  console.log("acceptJob tx:", tx2.hash);
  const tx3 = await boardWorker.submitDelivery(jobA, "ipfs://QmLocalDryRunA"); await tx3.wait();
  console.log("submitDelivery tx:", tx3.hash);
  const tx4 = await boardPoster.acceptDelivery(jobA); await tx4.wait();
  console.log("acceptDelivery tx:", tx4.hash);
  const wAfter = await bal(worker.address);
  const pAfter = await bal(poster.address);
  check("worker balance increased by exactly the reward", wAfter - wBefore === reward,
    `worker ${hre.ethers.formatUnits(wBefore, 6)} -> ${hre.ethers.formatUnits(wAfter, 6)} mUSDC`);
  check("poster balance decreased by exactly the reward", pBefore - pAfter === reward,
    `poster ${hre.ethers.formatUnits(pBefore, 6)} -> ${hre.ethers.formatUnits(pAfter, 6)} mUSDC`);
  check("job A status is Completed", (await board.getJob(jobA)).status === 3n);
  results.jobA = { jobId: jobA.toString(), txs: { post: tx1.hash, accept: tx2.hash, deliver: tx3.hash, acceptDelivery: tx4.hash } };

  console.log("\n== (c) negative: acceptJob without Agent ID must revert ==");
  await (await usdc.connect(poster).approve(await board.getAddress(), 10n * 10n ** 6n)).wait();
  const tx5 = await boardPoster.postJob("Negative-test job", "Only for the no-Agent-ID check.", 10n * 10n ** 6n, (await chainNow()) + 3600);
  const jobB = jobIdOf(await tx5.wait());
  console.log("postJob (neg test) tx:", tx5.hash, "jobId:", jobB.toString());
  let reverted = false;
  try { const t = await board.connect(stranger).acceptJob(jobB); await t.wait(); }
  catch (e) { reverted = true; console.log("acceptJob reverted as expected:", String(e.message).slice(0, 140)); }
  check("acceptJob without Agent ID reverts", reverted);
  check("stranger indeed holds 0 Agent ID", (await agentId.balanceOf(stranger.address)) === 0n);
  results.jobNeg = { jobId: jobB.toString(), postTx: tx5.hash };

  console.log("\n== (b) short-deadline job -> refund after deadline ==");
  const rewardC = 50n * 10n ** 6n;
  await (await usdc.connect(poster).approve(await board.getAddress(), rewardC)).wait();
  const tx6 = await boardPoster.postJob("Short-deadline job", "Expires in 60s for refund test.", rewardC, (await chainNow()) + 60);
  const jobC = jobIdOf(await tx6.wait());
  console.log("postJob (refund test) tx:", tx6.hash, "jobId:", jobC.toString());
  await boardWorker.acceptJob(jobC);
  // Balance AFTER posting: reward is locked in escrow, so refund must add it back.
  const pBeforeC = await bal(poster.address);
  await provider.send("evm_increaseTime", [120]);
  await provider.send("evm_mine");
  const tx7 = await boardWorker.refund(jobC); await tx7.wait();
  console.log("refund tx:", tx7.hash);
  const pAfterC = await bal(poster.address);
  check("poster balance restored by exactly the reward after refund", pAfterC - pBeforeC === rewardC,
    `poster ${hre.ethers.formatUnits(pBeforeC, 6)} -> ${hre.ethers.formatUnits(pAfterC, 6)} mUSDC`);
  check("job C status is Refunded", (await board.getJob(jobC)).status === 4n);
  results.jobRefund = { jobId: jobC.toString(), txs: { post: tx6.hash, refund: tx7.hash } };

  results.allPassed = results.checks.every((c) => c.ok);
  results.verifiedAt = new Date().toISOString();
  fs.writeFileSync(path.join(root, "verification.localhost-dryrun.json"), JSON.stringify(results, null, 2));
  console.log("\nALL CHECKS PASSED (local dry run). Wrote verification.localhost-dryrun.json");
}
main().catch((e) => { console.error(e); process.exit(1); });
