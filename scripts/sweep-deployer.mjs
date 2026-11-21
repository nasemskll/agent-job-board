// Sweep leftover mainnet BNB from the hackathon test deployer wallet to ENE's EVM wallet.
// Reads the deployer key from test-wallets.json (never prints it).
// Usage: node scripts/sweep-deployer.mjs
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';

const ENE_WALLET = '0x1bEe0Ec0865606F3A36d828D554E6dd471a772f1';
const RPCS = ['https://bsc-dataseed1.binance.org/', 'https://bsc-dataseed2.binance.org/'];

const wallets = JSON.parse(readFileSync(new URL('../test-wallets.json', import.meta.url), 'utf8'));
const deployerKey = wallets.deployer.privateKey;
const deployerAddr = wallets.deployer.address;

let provider = null;
for (const url of RPCS) {
  try {
    const p = new ethers.JsonRpcProvider(url);
    const chain = await p.getNetwork();
    if (chain.chainId === 56n) { provider = p; console.log('RPC OK:', url); break; }
  } catch (e) { console.log('RPC failed:', url, e.message); }
}
if (!provider) throw new Error('no working BSC mainnet RPC');

const wallet = new ethers.Wallet(deployerKey, provider);
console.log('deployer:', deployerAddr);
const balance = await provider.getBalance(deployerAddr);
console.log('deployer balance (BNB):', ethers.formatEther(balance));
if (balance === 0n) { console.log('nothing to sweep'); process.exit(0); }

const fee = await provider.getFeeData();
const gasPrice = fee.gasPrice ?? 1000000000n;
const gasLimit = 21000n;
const gasCost = gasLimit * gasPrice;
const margin = ethers.parseEther('0.0001');
const amount = balance - gasCost - margin;
if (amount <= 0n) throw new Error('balance too small to cover gas: ' + ethers.formatEther(balance));
console.log('gas price (gwei):', ethers.formatUnits(gasPrice, 'gwei'));
console.log('sending (BNB):', ethers.formatEther(amount), '->', ENE_WALLET);

const tx = await wallet.sendTransaction({ to: ENE_WALLET, value: amount, gasLimit, gasPrice });
console.log('tx hash:', tx.hash);
const receipt = await tx.wait(1);
console.log('confirmed in block', receipt.blockNumber, 'status', receipt.status);

const afterDeployer = await provider.getBalance(deployerAddr);
const afterEne = await provider.getBalance(ENE_WALLET);
console.log('deployer after (BNB):', ethers.formatEther(afterDeployer));
console.log('ENE wallet after (BNB):', ethers.formatEther(afterEne));
console.log('BscScan:', 'https://bscscan.com/tx/' + tx.hash);
