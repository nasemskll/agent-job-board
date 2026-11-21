const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AgentJobBoard (local hardhat network — same code path as testnet)", function () {
  let usdc, agentId, board, deployer, poster, worker, stranger;

  const REWARD = 100n * 10n ** 6n; // 100 mUSDC (6 decimals)
  const days = (n) => Math.floor(Date.now() / 1000) + n * 86400;

  beforeEach(async function () {
    [deployer, poster, worker, stranger] = await ethers.getSigners();
    usdc = await (await ethers.getContractFactory("MockUSDC", deployer)).deploy();
    agentId = await (await ethers.getContractFactory("MockAgentID", deployer)).deploy();
    board = await (await ethers.getContractFactory("AgentJobBoard", deployer)).deploy(
      await usdc.getAddress(), await agentId.getAddress()
    );
    await usdc.transfer(poster.address, 10_000n * 10n ** 6n);
    await agentId.mint(worker.address); // worker holds a mock Agent ID
    await usdc.connect(poster).approve(await board.getAddress(), 10_000n * 10n ** 6n);
  });

  async function postJob(reward = REWARD, deadline = days(1)) {
    const tx = await board.connect(poster).postJob("T", "D", reward, deadline);
    const rc = await tx.wait();
    const ev = rc.logs.map((l) => { try { return board.interface.parseLog(l); } catch { return null; } })
      .find((e) => e && e.name === "JobPosted");
    return ev.args.jobId;
  }

  it("(a) happy path: post -> accept -> deliver -> accept -> worker paid exactly the reward", async function () {
    const jobId = await postJob();
    expect(await usdc.balanceOf(await board.getAddress())).to.equal(REWARD);
    await board.connect(worker).acceptJob(jobId);
    await board.connect(worker).submitDelivery(jobId, "ipfs://QmTestA");
    const wBefore = await usdc.balanceOf(worker.address);
    await board.connect(poster).acceptDelivery(jobId);
    expect(await usdc.balanceOf(worker.address)).to.equal(wBefore + REWARD);
    expect((await board.getJob(jobId)).status).to.equal(3n); // Completed
    expect(await usdc.balanceOf(await board.getAddress())).to.equal(0);
  });

  it("rejectDelivery sends the job back to InProgress; worker can resubmit and still be paid", async function () {
    const jobId = await postJob();
    await board.connect(worker).acceptJob(jobId);
    await board.connect(worker).submitDelivery(jobId, "ipfs://QmBad");
    await board.connect(poster).rejectDelivery(jobId);
    expect((await board.getJob(jobId)).status).to.equal(1n); // InProgress
    expect((await board.getJob(jobId)).delivery).to.equal("");
    await board.connect(worker).submitDelivery(jobId, "ipfs://QmFixed");
    await board.connect(poster).acceptDelivery(jobId);
    expect((await board.getJob(jobId)).status).to.equal(3n);
  });

  it("(b) refund after deadline returns the reward to the poster (triggered by the worker)", async function () {
    const jobId = await postJob(50n * 10n ** 6n, Math.floor(Date.now() / 1000) + 60);
    await board.connect(worker).acceptJob(jobId);
    const pBefore = await usdc.balanceOf(poster.address);
    await ethers.provider.send("evm_increaseTime", [120]);
    await ethers.provider.send("evm_mine");
    await board.connect(worker).refund(jobId);
    expect(await usdc.balanceOf(poster.address)).to.equal(pBefore + 50n * 10n ** 6n);
    expect((await board.getJob(jobId)).status).to.equal(4n); // Refunded
  });

  it("refund before the deadline reverts", async function () {
    const jobId = await postJob();
    await expect(board.connect(poster).refund(jobId)).to.be.revertedWithCustomError(board, "DeadlineNotPassed");
  });

  it("(c) negative: acceptJob without an Agent ID reverts", async function () {
    const jobId = await postJob();
    expect(await agentId.balanceOf(stranger.address)).to.equal(0);
    await expect(board.connect(stranger).acceptJob(jobId))
      .to.be.revertedWithCustomError(board, "NotAgentHolder");
  });

  it("poster cannot accept their own job; only the worker can deliver; only the poster can accept", async function () {
    const jobId = await postJob();
    await expect(board.connect(poster).acceptJob(jobId)).to.be.revertedWithCustomError(board, "SelfAccept");
    await board.connect(worker).acceptJob(jobId);
    await expect(board.connect(stranger).submitDelivery(jobId, "x")).to.be.revertedWithCustomError(board, "NotWorker");
    await board.connect(worker).submitDelivery(jobId, "ipfs://QmX");
    await expect(board.connect(worker).acceptDelivery(jobId)).to.be.revertedWithCustomError(board, "NotPoster");
  });

  it("cancelJob on an Open job refunds the poster; postJob with zero reward or past deadline reverts", async function () {
    const jobId = await postJob();
    const pBefore = await usdc.balanceOf(poster.address);
    await board.connect(poster).cancelJob(jobId);
    expect(await usdc.balanceOf(poster.address)).to.equal(pBefore + REWARD);
    await expect(board.connect(poster).postJob("T", "D", 0, days(1)))
      .to.be.revertedWithCustomError(board, "ZeroReward");
    await expect(board.connect(poster).postJob("T", "D", REWARD, Math.floor(Date.now() / 1000) - 10))
      .to.be.revertedWithCustomError(board, "DeadlineNotSet");
  });

  it("owner cannot move user funds: no withdraw function exists on the board", async function () {
    expect(board.interface.getFunction("withdraw", "nonpayable")).to.throw;
    expect(board.owner()).to.not.be.reverted;
  });
});
