// Agent Job Board 前端业务代码（原生 JS + ethers v6 CDN）。
// 合约地址只从 config.js（APP_CONFIG）读；ABI 只从 abi.js（APP_ABI）读；
// 状态文案与按钮规则只从 logic.js（APP_LOGIC）读。本文件不写死任何地址。
(function () {
  "use strict";
  var L = window.APP_LOGIC;
  var CFG = window.APP_CONFIG;

  var provider = null;
  var signer = null;
  var account = null;
  var chainId = null;
  var netConfig = null;
  var board = null;
  var usdc = null;
  var agentId = null;
  // 只读公开读取（无需钱包）：公共 BSC RPC + 合约直读。
  // 招募页的死结正在这里——Agentic Wallet 连不上网页，常规钱包又接不了
  // Agent ID 的单；陌生人至少要能先看到任务列表。
  var readProvider = null;
  var readBoard = null;
  var readChainId = 56; // 只读模式当前查看的网络，默认 BSC 主网
  var holdsAgentId = false;
  var jobsCache = [];
  var cancelledIds = new Set();
  // 链上时间（最新区块时间戳）：退款是否可触发以合约的 block.timestamp 为准，
  // 不能用用户本机时钟 Date.now() 判断——两者可能相差很大（测试链快进时间、
  // 用户时钟偏差都会导致按钮显示错误）。
  var chainNowSec = null;

  // 当前网络的支付代币小数位与符号（本地/测试网：6 位 mUSDC；主网：18 位 USDC）。
  // 金额解析与展示一律走这两个函数，绝不要直接读 CFG.CONFIG.tokenDecimals。
  function activeDecimals() {
    if (netConfig && netConfig.tokenDecimals != null) return netConfig.tokenDecimals;
    return CFG.CONFIG.tokenDecimals;
  }
  function activeSymbol() {
    if (netConfig && netConfig.tokenSymbol) return netConfig.tokenSymbol;
    return "mUSDC";
  }

  function $(id) { return document.getElementById(id); }
  function setStatus(msg, isError) {
    var el = $("status");
    el.textContent = msg;
    el.style.color = isError ? "#b00020" : "#1a7f37";
  }
  function shortErr(e) {
    var m = (e && (e.reason || e.shortMessage || e.message)) || String(e);
    // 合约自定义错误名（如 NotAgentHolder）会出现在 revert 信息里，直接展示。
    return String(m).slice(0, 300);
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function connect() {
    if (!window.ethereum) {
      setStatus("未检测到钱包：请安装 MetaMask 或 Binance Wallet 后刷新页面。", true);
      return;
    }
    try {
      provider = new ethers.BrowserProvider(window.ethereum);
      var accounts = await provider.send("eth_requestAccounts", []);
      account = accounts[0] || null;
      await refresh();
      setStatus(account ? "已连接钱包。" : "未连接钱包。");
    } catch (e) {
      setStatus("连接钱包失败：" + shortErr(e), true);
    }
  }

  // 只读模式当前可用的 provider（钱包优先，只读兜底）。
  function activeProvider() { return provider || readProvider; }

  // 当前网络的公共 RPC 列表（config.js 的 rpcs；没有就用单个 rpc）。
  function rpcListFor(net) {
    if (net && net.rpcs && net.rpcs.length) return net.rpcs.slice();
    return [net.rpc];
  }

  // 只读初始化：用公共 RPC 直连合约读任务列表，不需要钱包。
  // 依次试 RPC 列表，拨通（getNetwork 且 chainId 相符）才算可用。
  async function initReadOnly(chainIdNum) {
    var cfg = CFG.configForChain(chainIdNum);
    if (!cfg) {
      jobsCache = [];
      $("jobList").innerHTML = "<p>不支持的网络（chainId " + esc(String(chainIdNum)) + "）。</p>";
      return;
    }
    var rpcs = rpcListFor(cfg);
    var lastErr = null;
    for (var k = 0; k < rpcs.length; k++) {
      try {
        var rp = new ethers.JsonRpcProvider(rpcs[k]);
        var net = await rp.getNetwork();
        if (Number(net.chainId) !== Number(chainIdNum)) throw new Error("RPC 返回的 chainId 不符");
        readProvider = rp;
        readBoard = new ethers.Contract(cfg.contracts.AgentJobBoard, window.APP_ABI.board, readProvider);
        board = readBoard;
        readChainId = Number(chainIdNum);
        chainId = Number(chainIdNum);
        netConfig = cfg;
        renderWallet();
        await loadJobs();
        return;
      } catch (e) { lastErr = e; }
    }
    setStatus("只读读取失败（公共 RPC 不可达）：" + shortErr(lastErr), true);
  }

  async function refresh() {
    if (!provider) { await initReadOnly(readChainId); return; }
    try {
      var net = await provider.getNetwork();
      chainId = Number(net.chainId);
      await CFG.loadDeploymentOverrides();
      netConfig = CFG.configForChain(chainId);
      signer = account ? await provider.getSigner() : null;
      renderWallet();
      if (!netConfig) { renderUnsupported(); return; }
      board = new ethers.Contract(netConfig.contracts.AgentJobBoard, window.APP_ABI.board, provider);
      usdc = new ethers.Contract(netConfig.contracts.MockUSDC, window.APP_ABI.usdc, provider);
      agentId = new ethers.Contract(netConfig.contracts.MockAgentID, window.APP_ABI.agentId, provider);
      await refreshBalances();
      await loadJobs();
    } catch (e) {
      setStatus("读取链上数据失败：" + shortErr(e), true);
    }
  }

  async function refreshBalances() {
    if (!account) { holdsAgentId = false; renderWallet(); return; }
    try {
      var bal = await agentId.balanceOf(account);
      holdsAgentId = bal > 0n;
      var ub = await usdc.balanceOf(account);
      $("usdcBalance").textContent = L.formatReward(ub, activeDecimals()) + " " + activeSymbol();
      var sym = await usdc.symbol().catch(function () { return ""; });
      if (sym) $("usdcBalance").textContent += "（" + esc(sym) + "）";
    } catch (e) {
      holdsAgentId = false;
    }
    renderWallet();
  }

  function renderWallet() {
    $("account").textContent = account || "未连接";
    $("chainId").textContent = chainId == null ? "—" : String(chainId) +
      (netConfig ? "（" + esc(netConfig.label) + "）" : "（不支持的网络）");
    var hold = $("agentIdStatus");
    if (!account) { hold.textContent = "未连接钱包"; hold.style.color = ""; }
    else if (holdsAgentId) { hold.textContent = "持有 Agent ID ✓"; hold.style.color = "#1a7f37"; }
    else { hold.textContent = "未持有 Agent ID"; hold.style.color = "#b00020"; }
    $("connectBtn").textContent = account ? "已连接" : "连接钱包";
    $("switchLocalBtn").disabled = !window.ethereum;
    $("switchTestnetBtn").disabled = !window.ethereum;
    $("switchMainnetBtn").disabled = !window.ethereum;
    // 按当前网络更新金额单位标签（本地/测试网：mUSDC 6 位；主网：USDC 18 位）。
    if (netConfig) {
      var lbl = $("usdcBalanceLabel");
      if (lbl) lbl.textContent = activeSymbol() + " 余额：";
      var rl = $("rewardLabel");
      if (rl) rl.textContent = "报酬（" + activeSymbol() + "，" + activeDecimals() + " 位小数）";
    }
  }

  function renderUnsupported() {
    jobsCache = [];
    $("jobList").innerHTML =
      "<p>当前网络（chainId " + esc(String(chainId)) + "）不受支持。" +
      "本页面仅支持本地 Hardhat（31337）、BSC 测试网（97）与 BSC 主网（56）。" +
      "请切换网络后重新连接。</p>";
    $("networkHint").textContent =
      "不支持的网络：请切换到本地 Hardhat（31337）、BSC 测试网（97）或 BSC 主网（56）。";
  }

  async function loadJobs() {
    if (!board) { setStatus("尚未选择网络。", true); return; }
    var total = Number(await board.nextJobId());
    var list = [];
    var box = $("jobList");
    // 逐个读：公共 RPC 对批量 eth_call 限流（33 个并行会直接报
    // rate limit），串行反而稳；实测 33 个任务约 3 秒，带进度提示。
    for (var i = 0; i < total; i++) {
      var j = null;
      for (var attempt = 0; attempt < 2 && !j; attempt++) {
        try { j = await board.getJob(i); }
        catch (e) {
          if (attempt === 0) await new Promise(function (r) { setTimeout(r, 500); });
        }
      }
      if (!j) { setStatus("读取任务 #" + i + " 失败，请稍后点“刷新任务列表”重试。", true); return; }
      list.push({
        id: i, poster: j.poster, worker: j.worker,
        reward: j.reward, reviewDeadline: j.reviewDeadline,
        title: j.title, description: j.description,
        delivery: j.delivery, status: Number(j.status),
      });
      if ((i + 1) % 5 === 0 || i === total - 1) {
        box.innerHTML = "<p>正在从链上读取任务 " + (i + 1) + "/" + total + "…</p>";
      }
    }
    // 区分“已取消”与“已退款”：cancelJob 也是状态 4，需查 JobCancelled 事件。
    // 公共 RPC 不支持从 0 号区块查全量日志，大多会失败并进 catch；
    // 失败时已取消会显示为已退款，不影响资金逻辑。
    cancelledIds = new Set();
    try {
      var evs = await board.queryFilter(board.filters.JobCancelled());
      evs.forEach(function (ev) { cancelledIds.add(String(ev.args.jobId)); });
    } catch (e) { /* 事件查不到时，已取消会显示为已退款，不影响资金逻辑 */ }
    jobsCache = list.reverse(); // 新任务在前
    var ap = activeProvider();
    try { chainNowSec = (await ap.getBlock("latest")).timestamp; } catch (e) { chainNowSec = null; }
    renderJobs();
    if (account) {
      $("networkHint").textContent = "已连接 " + netConfig.label +
        "，合约 " + netConfig.contracts.AgentJobBoard;
    } else {
      $("networkHint").textContent = "只读模式：正在查看 " + netConfig.label +
        " 的任务列表（公共 RPC，无需连接钱包），合约 " + netConfig.contracts.AgentJobBoard +
        "。发单、接单、交付、验收等操作需要连接钱包。";
    }
  }

  function renderJobs() {
    var box = $("jobList");
    if (!jobsCache.length) { box.innerHTML = "<p>暂无任务。发一个任务试试。</p>"; return; }
    var nowSec = chainNowSec || Math.floor(Date.now() / 1000); // 链上时间优先，本机时钟兜底
    box.innerHTML = jobsCache.map(function (job) {
      var status = L.statusText(job, cancelledIds);
      var refundable = L.isRefundable(job, nowSec);
      var acceptReason = L.acceptBlockReason(job, account, holdsAgentId);
      var html = '<article class="job">' +
        "<h3>#" + job.id + " " + esc(job.title) + "</h3>" +
        "<p>" + esc(job.description) + "</p>" +
        "<p>报酬：" + esc(L.formatReward(job.reward, activeDecimals())) + " " + esc(activeSymbol()) + " ｜ " +
        "状态：<b>" + esc(status) + "</b> ｜ " +
        "验收截止：" + esc(L.formatDeadline(job.reviewDeadline)) + "</p>" +
        "<p>发单方：" + esc(L.shortAddr(job.poster)) + " ｜ 接单方：" +
        esc(job.worker === ethers.ZeroAddress ? "—" : L.shortAddr(job.worker)) + "</p>";
      if (job.delivery) html += "<p>交付内容：" + esc(job.delivery) + "</p>";
      html += '<div class="actions">';
      if (acceptReason === null) {
        html += '<button data-act="accept" data-id="' + job.id + '">接单（需持有 Agent ID）</button>';
      } else if (Number(job.status) === 0) {
        html += '<button disabled title="' + esc(acceptReason) + '">接单</button>' +
          "<span class=\"reason\">" + esc(acceptReason) + "</span>";
      }
      if (L.canDeliver(job, account)) {
        html += '<input data-delivery="' + job.id + '" placeholder="交付链接或内容哈希" size="32"> ' +
          '<button data-act="deliver" data-id="' + job.id + '">提交交付</button>';
      }
      if (L.canReview(job, account)) {
        html += '<button data-act="acceptDelivery" data-id="' + job.id + '">验收并放款</button>' +
          '<button data-act="rejectDelivery" data-id="' + job.id + '">拒绝交付</button>';
      }
      if (refundable) {
        html += '<button data-act="refund" data-id="' + job.id + '">可退款：触发退款</button>';
      }
      if (L.canCancel(job, account)) {
        html += '<button data-act="cancel" data-id="' + job.id + '">取消任务</button>';
      }
      html += "</div></article>";
      return html;
    }).join("");
    box.querySelectorAll("button[data-act]").forEach(function (btn) {
      btn.addEventListener("click", function () { onJobAction(btn); });
    });
  }

  function needSigner() {
    if (!signer) { setStatus("请先连接钱包。", true); return null; }
    if (!netConfig) { setStatus("当前网络不受支持，请切换网络。", true); return null; }
    return board.connect(signer);
  }

  async function sendTx(promise, okMsg) {
    setStatus("交易已提交，等待确认…");
    var tx = await promise;
    var rc = await tx.wait();
    setStatus(okMsg + " 交易哈希：" + rc.hash);
    await refreshBalances();
    await loadJobs();
  }

  async function onJobAction(btn) {
    var id = Number(btn.getAttribute("data-id"));
    var act = btn.getAttribute("data-act");
    var b = needSigner();
    if (!b) return;
    try {
      if (act === "accept") {
        // 前端先按持有情况拦截；合约 acceptJob 还会再校验一次，不可绕过。
        var job = jobsCache.find(function (j) { return j.id === id; });
        var reason = L.acceptBlockReason(job, account, holdsAgentId);
        if (reason) { setStatus(reason, true); return; }
        await sendTx(b.acceptJob(id), "接单成功。");
      } else if (act === "deliver") {
        var input = document.querySelector('input[data-delivery="' + id + '"]');
        var delivery = input ? input.value.trim() : "";
        if (!delivery) { setStatus("请填写交付内容（链接或内容哈希）。", true); return; }
        await sendTx(b.submitDelivery(id, delivery), "交付已提交。");
      } else if (act === "acceptDelivery") {
        await sendTx(b.acceptDelivery(id), "已验收，托管报酬已放款给接单方。");
      } else if (act === "rejectDelivery") {
        await sendTx(b.rejectDelivery(id), "已拒绝交付，任务回到进行中，接单方可重新交付。");
      } else if (act === "refund") {
        await sendTx(b.refund(id), "退款已触发，报酬已退回发单方。");
      } else if (act === "cancel") {
        await sendTx(b.cancelJob(id), "任务已取消，锁定报酬已退回发单方。");
      }
    } catch (e) {
      setStatus("交易失败：" + shortErr(e), true);
    }
  }

  async function postJob(ev) {
    ev.preventDefault();
    var b = needSigner();
    if (!b) return;
    var title = $("title").value.trim();
    var desc = $("description").value.trim();
    var rewardStr = $("reward").value.trim();
    var deadlineStr = $("deadline").value;
    if (!title || !desc || !rewardStr || !deadlineStr) {
      setStatus("请把标题、描述、报酬、验收截止时间都填好。", true); return;
    }
    var reward, deadline;
    try {
      reward = ethers.parseUnits(rewardStr, activeDecimals());
      deadline = Math.floor(new Date(deadlineStr).getTime() / 1000);
    } catch (e) { setStatus("报酬或截止时间格式不对：" + shortErr(e), true); return; }
    if (reward <= 0n) { setStatus("报酬必须大于 0。", true); return; }
    var nowSec = chainNowSec || Math.floor(Date.now() / 1000);
    if (deadline <= nowSec) {
      setStatus("验收截止时间必须是未来时间（以链上时间为准）。", true); return;
    }
    try {
      var u = usdc.connect(signer);
      var allowance = await u.allowance(account, await board.getAddress());
      if (allowance < reward) {
        setStatus("正在授权（approve）托管合约使用报酬…");
        var atx = await u.approve(await board.getAddress(), reward);
        await atx.wait();
      }
      await sendTx(b.postJob(title, desc, reward, deadline), "发单成功，报酬已锁定进托管合约。");
      $("postForm").reset();
      setDefaultDeadline();
    } catch (e) {
      setStatus("发单失败：" + shortErr(e), true);
    }
  }

  async function switchChain(target, params) {
    if (!window.ethereum) { setStatus("未检测到钱包。", true); return; }
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x" + target.toString(16) }],
      });
    } catch (e) {
      if (e && e.code === 4902) {
        try {
          await window.ethereum.request({ method: "wallet_addEthereumChain", params: [params] });
        } catch (e2) { setStatus("添加网络失败：" + shortErr(e2), true); }
      } else {
        setStatus("切换网络失败：" + shortErr(e), true);
      }
    }
  }

  function setDefaultDeadline() {
    var d = new Date(Date.now() + 24 * 3600 * 1000);
    var pad = function (n) { return String(n).padStart(2, "0"); };
    $("deadline").value = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (typeof window.ethers === "undefined") {
      setStatus("ethers 库未加载：请确认 frontend/vendor/ethers.umd.min.js 存在，或联网后刷新页面。", true);
      return;
    }
    setDefaultDeadline();
    $("connectBtn").addEventListener("click", connect);
    $("refreshBtn").addEventListener("click", refresh);
    $("postForm").addEventListener("submit", postJob);
    $("switchLocalBtn").addEventListener("click", function () {
      switchChain(31337, {
        chainId: "0x7a69", chainName: "Hardhat Localhost",
        rpcUrls: ["http://127.0.0.1:8545"], nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      });
    });
    $("switchTestnetBtn").addEventListener("click", function () {
      switchChain(97, {
        chainId: "0x61", chainName: "BNB Smart Chain Testnet",
        rpcUrls: ["https://data-seed-prebsc-1-s1.binance.org:8545/"],
        nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
        blockExplorerUrls: ["https://testnet.bscscan.com"],
      });
    });
    $("switchMainnetBtn").addEventListener("click", function () {
      switchChain(56, {
        chainId: "0x38", chainName: "BNB Smart Chain",
        rpcUrls: ["https://bsc-dataseed.binance.org/"],
        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
        blockExplorerUrls: ["https://bscscan.com"],
      });
    });
    var sel = $("readNetSelect");
    if (sel) {
      sel.addEventListener("change", function () { initReadOnly(Number(sel.value)); });
    }
    // 任务列表默认只读公开加载（BSC 主网）：不连钱包也能看。
    // 有钱包且已授权时，下面再走钱包流程补余额与持有状态。
    initReadOnly(readChainId);
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", function (accs) {
        account = accs[0] || null; refresh();
      });
      window.ethereum.on("chainChanged", function () { refresh(); });
      // 已授权过钱包时自动恢复连接状态；未授权时不弹窗，等用户点“连接钱包”。
      provider = new ethers.BrowserProvider(window.ethereum);
      provider.send("eth_accounts", []).then(function (accs) {
        if (accs && accs.length) { account = accs[0]; refresh(); }
        else { renderWallet(); }
      }).catch(function () { renderWallet(); });
    } else {
      renderWallet();
    }
  });
})();
