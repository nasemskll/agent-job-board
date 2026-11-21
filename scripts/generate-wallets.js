// Generate 2 fresh test-only wallets (poster + worker) + 1 deployer wallet.
// Run once:  node scripts/generate-wallets.js
// Writes test-wallets.json with chmod 600. The file is gitignored.
// ADDRESSES are printed (safe to share); PRIVATE KEYS are never printed.
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const outPath = path.join(__dirname, "..", "test-wallets.json");
if (fs.existsSync(outPath)) {
  console.log("test-wallets.json already exists — refusing to overwrite. Delete it first if you really want fresh wallets.");
  process.exit(1);
}

const mk = (role) => {
  const w = ethers.Wallet.createRandom();
  return { role, address: w.address, privateKey: w.privateKey, mnemonic: w.mnemonic.phrase };
};

const wallets = {
  network: "BSC Testnet (chainId 97) — TESTNET ONLY, no real value",
  deployer: mk("deployer"),
  poster: mk("poster"),
  worker: mk("worker"),
};

fs.writeFileSync(outPath, JSON.stringify(wallets, null, 2));
fs.chmodSync(outPath, 0o600);

console.log("Wallets written to test-wallets.json (chmod 600).");
console.log("Deployer:", wallets.deployer.address);
console.log("Poster:  ", wallets.poster.address);
console.log("Worker:  ", wallets.worker.address);
console.log("Next: fund the DEPLOYER address with tBNB from the faucet:");
console.log("  https://testnet.bnbchain.org/faucet-smart  (captcha required, 0.3 tBNB/day)");
console.log("Then run: npx hardhat run scripts/deploy.js --network bsctestnet");
