// 前端纯逻辑（无 DOM、无钱包依赖）：状态文案、按钮可用性、退款判断。
// 浏览器（app.js）与 Node 验证脚本（scripts/verify-frontend.js）共用同一份，
// 避免“页面上显示的规则”与“验证时用的规则”各写一份。
(function (root) {
  // 合约 Status 枚举：0 Open / 1 InProgress / 2 Delivered / 3 Completed / 4 Refunded。
  // 注意：cancelJob 也把状态置为 Refunded（4），链上 getJob 无法区分
  // “退款”与“取消”，需结合 JobCancelled 事件判断（见 statusText 的
  // cancelledIds 参数）。
  const STATUS_TEXT = {
    0: "待接单",
    1: "进行中",
    2: "已交付，待验收",
    3: "已完成",
    4: "已退款",
  };

  function statusText(job, cancelledIds) {
    const s = Number(job.status);
    if (s === 4 && cancelledIds && cancelledIds.has(String(job.id))) return "已取消";
    return STATUS_TEXT[s] || "未知状态";
  }

  // 超过验收截止时间、且尚未完成/退款的任务，任何人可触发退款。
  function isRefundable(job, nowSec) {
    const s = Number(job.status);
    return (s === 0 || s === 1 || s === 2) && Number(nowSec) > Number(job.reviewDeadline);
  }

  function sameAddr(a, b) {
    return !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
  }

  // 接单按钮：返回 null 表示可以接单，否则返回不可接单的原因（页面展示，
  // 不绕过；合约 acceptJob 还会再校验一次 Agent ID 持有情况）。
  function acceptBlockReason(job, account, holdsAgentId) {
    if (!account) return "请先连接钱包";
    if (Number(job.status) !== 0) return "任务不在待接单状态";
    if (sameAddr(account, job.poster)) return "发单方不能接自己的任务";
    if (!holdsAgentId) return "当前地址未持有 Agent ID，无法接单";
    return null;
  }

  function canDeliver(job, account) {
    return !!account && Number(job.status) === 1 && sameAddr(account, job.worker);
  }

  // 验收 / 拒绝：仅发单方、仅已交付状态。
  function canReview(job, account) {
    return !!account && Number(job.status) === 2 && sameAddr(account, job.poster);
  }

  // 取消：仅发单方、仅无人接单（Open）状态。
  function canCancel(job, account) {
    return !!account && Number(job.status) === 0 && sameAddr(account, job.poster);
  }

  function formatReward(reward, decimals) {
    const d = decimals === undefined ? 6 : decimals;
    const s = String(reward);
    if (s.length <= d) {
      const frac = s.padStart(d, "0").replace(/0+$/, "");
      return frac ? "0." + frac : "0";
    }
    const int = s.slice(0, s.length - d);
    const frac = s.slice(s.length - d).replace(/0+$/, "");
    return frac ? int + "." + frac : int;
  }

  function formatDeadline(ts) {
    const d = new Date(Number(ts) * 1000);
    return isNaN(d.getTime()) ? "—" : d.toLocaleString();
  }

  function shortAddr(addr) {
    if (!addr) return "—";
    return addr.slice(0, 6) + "…" + addr.slice(-4);
  }

  const api = {
    STATUS_TEXT, statusText, isRefundable, acceptBlockReason,
    canDeliver, canReview, canCancel, sameAddr,
    formatReward, formatDeadline, shortAddr,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.APP_LOGIC = api;
})(typeof window !== "undefined" ? window : globalThis);
