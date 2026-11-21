// Submit AgentJobBoard to Sourcify via API v2 (standard JSON).
// No API key needed. Uses the Hardhat build-info standard JSON input.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONTRACT = "0x91C9aFecC98289Cf21F13f26056801B38cEBcdEe";
const CHAIN_ID = 56;
const CREATE_TX = "0x78458524ac641645a83d7a2c86ad47b695261d3c93f59db225064aa5928cafed";
const CONTRACT_ID = "contracts/AgentJobBoard.sol:AgentJobBoard";
const UA = "agent-job-board/1.0 (+https://ene.lxi.be)";

async function main() {
  const dir = path.join(__dirname, "..", "artifacts", "build-info");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (!files.length) throw new Error("No build-info found.");
  // Pick the newest build-info (the --force compile just wrote it).
  files.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
  const info = JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf8"));
  console.log("build-info:", files[0], "| solcVersion:", info.solcVersion);

  const stdJsonInput = info.input;
  // Sourcify only stores language/sources/settings (+ storage_layout_overrides).
  // Drop anything else Hardhat may have added.
  const clean = {
    language: stdJsonInput.language,
    sources: stdJsonInput.sources,
    settings: stdJsonInput.settings,
  };
  console.log("sources in input:", Object.keys(clean.sources).length);

  const body = {
    stdJsonInput: clean,
    compilerVersion: info.solcLongVersion || info.solcVersion,
    contractIdentifier: CONTRACT_ID,
    creationTransactionHash: CREATE_TX,
  };

  const res = await fetch(`https://sourcify.dev/server/v2/verify/${CHAIN_ID}/${CONTRACT}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log("submit status:", res.status);
  console.log("submit body:", text.slice(0, 2000));
  if (res.status !== 202) {
    throw new Error(`Sourcify submit failed with status ${res.status}`);
  }
  const { verificationId } = JSON.parse(text);

  // Poll the job status (break as soon as the job completes).
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await fetch(`https://sourcify.dev/server/v2/verify/${verificationId}`, {
      headers: { "User-Agent": UA },
    });
    const sj = await st.json();
    const summary = {
      isJobCompleted: sj.isJobCompleted,
      match: sj.contract ? sj.contract.match : undefined,
      creationMatch: sj.contract ? sj.contract.creationMatch : undefined,
      runtimeMatch: sj.contract ? sj.contract.runtimeMatch : undefined,
      error: sj.error ? sj.error.message : undefined,
    };
    console.log(`poll ${i + 1}:`, JSON.stringify(summary));
    if (sj.isJobCompleted) break;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
