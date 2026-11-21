// 前端调用路径验证（本地 dry-run，只能跑 chainId 31337）。
// 与页面共用同一份前端代码：frontend/abi.js、frontend/config.js、
// frontend/logic.js（require 进来，不是另抄一份），再用 ethers JsonRpcProvider
// 代替浏览器钱包（window.ethereum），按页面 app.js 的顺序调同一批合约方法：
//   balanceOf（Agent ID 持有检查）-> nextJobId/getJob（任务列表）
//   -> approve + postJob（发单）-> acceptJob（接单，前端先按 logic.js 拦截）
//   -> submitDelivery -> acceptDelivery / rejectDelivery
//   -> refund（超时退款）/ cancelJob（取消）。
// 跑法（先起本地节点并部署，见 README“前端”一节）：
//   npx hardhat node --port 8545
//   npx hardhat run scripts/fund-local.js --network localhost
//   npx hardhat run scripts/deploy.js --network localhost
//   node scripts/verify-frontend.js
// 写 verification.frontend-local.json。绝不跑测试网/主网。
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const root = path.join(__dirname, "..");
const ABI = require(path.join(root, "frontend", "abi.js"));
const { configForChain } = require(path.join(root, "frontend", "config.js"));
const L = require(path.join(root, "frontend", "logic.js"));

async function main() {
  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== 31337) throw new Error("Local dry-run only (chainId 31337).");
  const cfg = configForChain(31337);
  if (!cfg) throw new Error("No local config for 31337 in frontend/config.js");

  const wallets = JSON.parse(fs.readFileSync(path.join(root, "test-wallets.json"), "utf8"));
  // NonceManager：本地 Hardhat 节点上连续发交易时，刚挖出块后立刻读
  // eth_getTransactionCount 可能返回旧值导致 nonce 复用而失败；NonceManager
  // 在本地跟踪 nonce，避免这个问题。浏览器里 nonce 由钱包（MetaMask 等）
  // 管理，前端 app.js 不受影响。
  const posterWallet = new ethers.Wallet(wallets.poster.privateKey, provider);
  const workerWallet = new ethers.Wallet(wallets.worker.privateKey, provider);
  const posterAddr = posterWallet.address;
  const workerAddr = workerWallet.address;
  const poster = new ethers.NonceManager(posterWallet);
  const worker = new ethers.NonceManager(workerWallet);
  const stranger = (await provider.getSigner(5)); // no Agent ID
  const strangerAddr = await stranger.getAddress();

  const board = new ethers.Contract(cfg.contracts.AgentJobBoard, ABI.board, provider);
  const usdc = new ethers.Contract(cfg.contracts.MockUSDC, ABI.usdc, provider);
  const agentId = new ethers.Contract(cfg.contracts.MockAgentID, ABI.agentId, provider);
  const boardPoster = board.connect(poster);
  const boardWorker = board.connect(worker);
  const results = { network: "Local Hardhat node (dry run)", chainId: 31337, checks: [] };
  const check = (name, ok, detail) => {
    results.checks.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail || ""}`);
    if (!ok) throw new Error(`Check failed: ${name}`);
  };
  const bal = (a) => usdc.balanceOf(a);
  // 注意：ethers v6 的 provider.getBlock("latest") 在刚挖出块后立即读会返回
  // 轮询缓存里的旧区块（实测：evm_mine 后马上读，raw eth_blockNumber 已是
  // 新块，getBlockNumber 仍是旧块，约 4 秒轮询间隔后才更新）。链上时间必须
  // 用 provider.send 直接调 eth_getBlockByNumber 读，否则超时判断会误判。
  const chainNow = async () => {
    const b = await provider.send("eth_getBlockByNumber", ["latest", false]);
    return parseInt(b.timestamp, 16);
  };
  const jobIdOf = (rc) => {
    const e = rc.logs.map((l) => { try { return board.interface.parseLog(l); } catch { return null; } })
      .find((x) => x && x.name === "JobPosted");
    return e.args.jobId;
  };
  // 与 app.js 的 loadJobs() 相同的读法。
  const readJobs = async () => {
    const total = Number(await board.nextJobId());
    const list = [];
    for (let i = 0; i < total; i++) list.push(await board.getJob(i));
    return list;
  };

  console.log("\n== frontend: Agent ID holding check (balanceOf, same call as the page) ==");
  const workerHolds = (await agentId.balanceOf(workerAddr)) > 0n;
  const posterHolds = (await agentId.balanceOf(posterAddr)) > 0n;
  const strangerHolds = (await agentId.balanceOf(strangerAddr)) > 0n;
  check("worker holds an Agent ID (page shows 持有)", workerHolds === true);
  check("poster holds no Agent ID", posterHolds === false);
  check("stranger holds no Agent ID", strangerHolds === false);
  const jobsBefore = await readJobs();
  check("job list reads via nextJobId + getJob", Array.isArray(jobsBefore));

  console.log("\n== (a) approve + post -> accept -> deliver -> accept -> payout ==");
  const reward = 100n * 10n ** 6n;
  const wBefore = await bal(workerAddr);
  const pBefore = await bal(posterAddr);
  await (await usdc.connect(poster).approve(await board.getAddress(), reward)).wait();
  const tx1 = await boardPoster.postJob("Frontend flow task", "Posted through the frontend call path.", reward, (await chainNow()) + 3600);
  const jobA = jobIdOf(await tx1.wait());
  console.log("postJob tx:", tx1.hash, "jobId:", jobA.toString());
  const jobAData = await board.getJob(jobA);
  const jobAObj = { id: jobA.toString(), status: Number(jobAData.status), poster: jobAData.poster, reviewDeadline: jobAData.reviewDeadline };
  check("frontend gating allows the worker to accept", L.acceptBlockReason(jobAObj, workerAddr, workerHolds) === null);
  check("frontend gating blocks a non-holder with a reason", L.acceptBlockReason(jobAObj, strangerAddr, strangerHolds) !== null);
  check("frontend gating blocks the poster accepting their own job", L.acceptBlockReason(jobAObj, posterAddr, posterHolds) !== null);
  const tx2 = await boardWorker.acceptJob(jobA); await tx2.wait();
  const tx3 = await boardWorker.submitDelivery(jobA, "ipfs://QmFrontendA"); await tx3.wait();
  const tx4 = await boardPoster.acceptDelivery(jobA); await tx4.wait();
  const wAfter = await bal(workerAddr);
  const pAfter = await bal(posterAddr);
  check("worker balance increased by exactly the reward", wAfter - wBefore === reward,
    `worker ${ethers.formatUnits(wBefore, 6)} -> ${ethers.formatUnits(wAfter, 6)} mUSDC`);
  check("poster balance decreased by exactly the reward", pBefore - pAfter === reward,
    `poster ${ethers.formatUnits(pBefore, 6)} -> ${ethers.formatUnits(pAfter, 6)} mUSDC`);
  check("job A status text is 已完成", L.statusText({ status: Number((await board.getJob(jobA)).status), id: jobA.toString() }, new Set()) === "已完成");
  results.jobA = { jobId: jobA.toString(), txs: { post: tx1.hash, accept: tx2.hash, deliver: tx3.hash, acceptDelivery: tx4.hash } };

  console.log("\n== reject -> resubmit -> accept (same worker keeps the job) ==");
  await (await usdc.connect(poster).approve(await board.getAddress(), reward)).wait();
  const tx5 = await boardPoster.postJob("Reject-flow task", "Will be rejected once, then resubmitted.", reward, (await chainNow()) + 3600);
  const jobB = jobIdOf(await tx5.wait());
  await (await boardWorker.acceptJob(jobB)).wait();
  await (await boardWorker.submitDelivery(jobB, "ipfs://QmBad")).wait();
  await (await boardPoster.rejectDelivery(jobB)).wait();
  const afterReject = await board.getJob(jobB);
  check("after reject, status is back to InProgress (进行中)", Number(afterReject.status) === 1);
  check("after reject, delivery is cleared", afterReject.delivery === "");
  const wBeforeB = await bal(workerAddr);
  await (await boardWorker.submitDelivery(jobB, "ipfs://QmFixed")).wait();
  await (await boardPoster.acceptDelivery(jobB)).wait();
  check("resubmitted delivery is accepted and worker is paid", (await bal(workerAddr)) - wBeforeB === reward);
  results.jobReject = { jobId: jobB.toString() };

  console.log("\n== (c) negative: acceptJob without Agent ID reverts (page blocks first, contract enforces) ==");
  await (await usdc.connect(poster).approve(await board.getAddress(), 10n * 10n ** 6n)).wait();
  const tx6 = await boardPoster.postJob("Negative-test job", "Only for the no-Agent-ID check.", 10n * 10n ** 6n, (await chainNow()) + 3600);
  const jobC = jobIdOf(await tx6.wait());
  let reverted = false;
  try { const t = await board.connect(stranger).acceptJob(jobC); await t.wait(); }
  catch (e) { reverted = true; console.log("acceptJob reverted as expected:", String(e.message).slice(0, 140)); }
  check("acceptJob without Agent ID reverts", reverted);

  console.log("\n== cancel: Open job cancelled by poster shows 已取消 (not 已退款) ==");
  await (await usdc.connect(poster).approve(await board.getAddress(), 10n * 10n ** 6n)).wait();
  const tx7 = await boardPoster.postJob("Cancel-test job", "Poster cancels before anyone accepts.", 10n * 10n ** 6n, (await chainNow()) + 3600);
  const jobD = jobIdOf(await tx7.wait());
  const pBeforeD = await bal(posterAddr);
  await (await boardPoster.cancelJob(jobD)).wait();
  const cancelled = new Set(
    (await board.queryFilter(board.filters.JobCancelled())).map((e) => String(e.args.jobId))
  );
  const jobDData = await board.getJob(jobD);
  check("cancelled job status text is 已取消", L.statusText({ status: Number(jobDData.status), id: jobD.toString() }, cancelled) === "已取消");
  check("cancel refunds the poster exactly the reward", (await bal(posterAddr)) - pBeforeD === 10n * 10n ** 6n);
  results.jobCancel = { jobId: jobD.toString() };

  console.log("\n== (b) short-deadline job -> refundable flag flips after deadline -> refund ==");
  const rewardE = 50n * 10n ** 6n;
  await (await usdc.connect(poster).approve(await board.getAddress(), rewardE)).wait();
  const tx8 = await boardPoster.postJob("Short-deadline job", "Expires in 60s for refund test.", rewardE, (await chainNow()) + 60);
  const jobE = jobIdOf(await tx8.wait());
  await (await boardWorker.acceptJob(jobE)).wait();
  const jobEData = await board.getJob(jobE);
  const jobEObj = { id: jobE.toString(), status: Number(jobEData.status), reviewDeadline: jobEData.reviewDeadline };
  check("before deadline the page does NOT show refundable", L.isRefundable(jobEObj, await chainNow()) === false);
  const pBeforeE = await bal(posterAddr);
  await provider.send("evm_increaseTime", [120]);
  await provider.send("evm_mine");
  check("after deadline the page shows refundable", L.isRefundable(jobEObj, await chainNow()) === true);
  const tx9 = await boardWorker.refund(jobE); await tx9.wait();
  const pAfterE = await bal(posterAddr);
  check("poster balance restored by exactly the reward after refund", pAfterE - pBeforeE === rewardE,
    `poster ${ethers.formatUnits(pBeforeE, 6)} -> ${ethers.formatUnits(pAfterE, 6)} mUSDC`);
  check("refunded job status text is 已退款", L.statusText({ status: Number((await board.getJob(jobE)).status), id: jobE.toString() }, cancelled) === "已退款");
  results.jobRefund = { jobId: jobE.toString(), txs: { post: tx8.hash, refund: tx9.hash } };

  const jobsAfter = await readJobs();
  check("job list grew and still reads after the flow", jobsAfter.length > jobsBefore.length,
    `${jobsBefore.length} -> ${jobsAfter.length} jobs`);

  results.allPassed = results.checks.every((c) => c.ok);
  results.verifiedAt = new Date().toISOString();
  fs.writeFileSync(path.join(root, "verification.frontend-local.json"), JSON.stringify(results, null, 2));
  console.log("\nALL CHECKS PASSED (frontend call path, local dry run). Wrote verification.frontend-local.json");
}
main().catch((e) => { console.error(e); process.exit(1); });
