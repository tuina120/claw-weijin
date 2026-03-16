const nodes = {
  refreshBtn: document.getElementById("refresh-btn"),
  copyBtn: document.getElementById("copy-btn"),
  status: document.getElementById("status"),
  summaryBadge: document.getElementById("summary-badge"),
  summaryText: document.getElementById("summary-text"),
  clientTraceList: document.getElementById("client-trace-list"),
  serverTraceList: document.getElementById("server-trace-list"),
  rawOutput: document.getElementById("raw-output")
};

let latestResultText = "";

init();

function init() {
  nodes.refreshBtn.addEventListener("click", () => void runDetection());
  nodes.copyBtn.addEventListener("click", () => void copyResult());
  void runDetection();
}

async function runDetection() {
  setStatus("正在检测当前网络...");
  try {
    const [serverInfo, clientTrace] = await Promise.all([loadServerInfo(), loadClientTrace()]);
    const summary = buildSummary(serverInfo, clientTrace);

    renderSummary(summary);
    renderKv(nodes.clientTraceList, buildClientRows(clientTrace, summary));
    renderKv(nodes.serverTraceList, buildServerRows(serverInfo));
    latestResultText = buildCopyText(serverInfo, clientTrace, summary);
    nodes.rawOutput.textContent = JSON.stringify(
      {
        summary,
        clientTrace,
        serverInfo
      },
      null,
      2
    );
    setStatus(`检测完成：${summary.label}`);
  } catch (error) {
    nodes.summaryBadge.className = "summary-badge danger";
    nodes.summaryBadge.textContent = "检测失败";
    nodes.summaryText.textContent = error.message || "读取网络信息失败";
    nodes.clientTraceList.innerHTML = "";
    nodes.serverTraceList.innerHTML = "";
    nodes.rawOutput.textContent = String(error.stack || error.message || error);
    latestResultText = "";
    setStatus(error.message || "检测失败", true);
  }
}

async function loadServerInfo() {
  const resp = await fetch("/api/network/info", { cache: "no-store" });
  const data = await readMaybeJson(resp);
  if (!resp.ok) {
    throw new Error(data?.error || `服务端请求失败（HTTP ${resp.status}）`);
  }
  return data || {};
}

async function loadClientTrace() {
  if (isLocalOnlyHost(location.hostname)) {
    return {
      available: false,
      reason: "当前是本机地址；如需真实公网链路，请从 https://file.qxyx.net/network.html 打开本页。"
    };
  }

  const resp = await fetch("/cdn-cgi/trace", { cache: "no-store" });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`读取 Cloudflare Trace 失败（HTTP ${resp.status}）`);
  }
  const parsed = parseTraceText(text);
  return {
    available: true,
    raw: text,
    ...parsed
  };
}

function parseTraceText(text) {
  const result = {};
  String(text || "")
    .split(/\r?\n/)
    .forEach((line) => {
      const index = line.indexOf("=");
      if (index < 0) return;
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim();
      if (key) result[key] = value;
    });
  return result;
}

function classifyNetwork(trace, serverInfo) {
  const colo = String(trace?.colo || serverInfo?.cloudflare?.colo || "").trim().toUpperCase();
  const loc = String(trace?.loc || serverInfo?.client?.country || "").trim().toUpperCase();
  const mainlandColos = new Set(["PEK", "PKX", "SHA", "PVG", "CAN", "SZX", "HGH", "CTU", "CKG", "WUH", "XMN", "TSN", "TAO"]);
  const nearbyColos = new Set(["HKG", "TPE", "KHH", "MFM", "NRT", "KIX", "ICN", "SIN"]);

  if (mainlandColos.has(colo)) {
    return {
      tone: "good",
      label: "国内落地",
      detail: `当前命中的 Cloudflare 边缘节点是 ${colo}，属于中国大陆节点。`
    };
  }
  if (loc === "CN" && nearbyColos.has(colo)) {
    return {
      tone: "warn",
      label: "中国网络，经近境外节点",
      detail: `当前访问源在中国，命中的边缘节点是 ${colo}，更像经香港/日本/新加坡等近境外节点出海。`
    };
  }
  if (loc === "CN" && colo) {
    return {
      tone: "danger",
      label: "中国网络，经远端海外节点",
      detail: `当前访问源在中国，但命中的边缘节点是 ${colo}，更像走远端海外链路。`
    };
  }
  if (colo) {
    return {
      tone: "danger",
      label: "海外网络",
      detail: `当前出口或访问节点更像在海外，命中的边缘节点是 ${colo}。`
    };
  }
  return {
    tone: "warn",
    label: "无法判断",
    detail: "没有拿到足够的节点信息，请重试。"
  };
}

function buildSummary(serverInfo, clientTrace) {
  if (!clientTrace?.available) {
    return {
      tone: "warn",
      label: "本机视角",
      detail: clientTrace?.reason || "当前不是公网访问视角，只能看到服务端侧信息。"
    };
  }
  return classifyNetwork(clientTrace, serverInfo);
}

function buildClientRows(trace, summary) {
  if (!trace?.available) {
    return [
      ["状态", "不可直接检测"],
      ["说明", trace?.reason || "未拿到浏览器侧 Cloudflare Trace"]
    ];
  }
  return [
    ["结论", `${summary.label} / ${summary.detail}`],
    ["出口 IP", trace.ip || "-"],
    ["访问源国家", trace.loc || "-"],
    ["Cloudflare 节点", trace.colo || "-"],
    ["访问主机", trace.h || location.host || "-"],
    ["协议", trace.http || "-"],
    ["TLS", trace.tls || "-"],
    ["时间戳", trace.ts || "-"]
  ];
}

function buildServerRows(serverInfo) {
  return [
    ["请求主机", serverInfo?.request?.host || "-"],
    ["服务端看到的客户端 IP", serverInfo?.client?.ip || "-"],
    ["CF-Connecting-IP", serverInfo?.client?.cfConnectingIp || "-"],
    ["CF 国家", serverInfo?.client?.country || "-"],
    ["CF Ray", serverInfo?.cloudflare?.ray || "-"],
    ["CF 节点", serverInfo?.cloudflare?.colo || "-"],
    ["公网 origin", serverInfo?.request?.origin || "-"],
    ["检测时间", formatDateTime(serverInfo?.now)]
  ];
}

function renderSummary(summary) {
  nodes.summaryBadge.className = `summary-badge ${summary.tone || "warn"}`;
  nodes.summaryBadge.textContent = summary.label || "无法判断";
  nodes.summaryText.textContent = summary.detail || "";
}

function renderKv(root, rows) {
  root.innerHTML = "";
  rows.forEach(([label, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    root.appendChild(dt);
    root.appendChild(dd);
  });
}

function buildCopyText(serverInfo, clientTrace, summary) {
  return [
    `检测时间：${formatDateTime(serverInfo?.now)}`,
    `结论：${summary.label}`,
    `说明：${summary.detail}`,
    `浏览器出口 IP：${clientTrace?.ip || "-"}`,
    `浏览器国家：${clientTrace?.loc || "-"}`,
    `Cloudflare 节点：${clientTrace?.colo || serverInfo?.cloudflare?.colo || "-"}`,
    `请求主机：${serverInfo?.request?.host || "-"}`,
    `服务端看到的客户端 IP：${serverInfo?.client?.ip || "-"}`
  ].join("\n");
}

async function copyResult() {
  if (!latestResultText) {
    setStatus("当前没有可复制的检测结果", true);
    return;
  }
  try {
    await navigator.clipboard.writeText(latestResultText);
    setStatus("检测结果已复制");
  } catch (_error) {
    setStatus("复制失败，请手动复制原始结果", true);
  }
}

function setStatus(message, isError = false) {
  nodes.status.textContent = `状态：${message}`;
  nodes.status.style.color = isError ? "#ffb6b6" : "";
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function isLocalOnlyHost(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
}

async function readMaybeJson(resp) {
  const text = await resp.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}
