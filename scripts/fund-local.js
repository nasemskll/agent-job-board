// LOCAL DRY-RUN ONLY: fund the test wallets from Hardhat account #0.
// Run against a local `npx hardhat node` — never on a public network.
//   npx hardhat run scripts/fund-local.js --network localhost
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const net = await hre.ethers.provider.getNetwork();
  if (Number(net.chainId) !== 31337) throw new Error("Local dry-run only (chainId 31337).");
  const [funder] = await hre.ethers.getSigners();
  const wallets = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "test-wallets.json"), "utf8"));
  for (const k of ["deployer", "poster", "worker"]) {
    const tx = await funder.sendTransaction({ to: wallets[k].address, value: hre.ethers.parseEther("1") });
    await tx.wait();
    console.log("funded", k, tx.hash);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
