const { URL } = require('url');

const NODE_SCHEME_RE = /(vmess|vless|trojan|ss|tuic|hysteria2|hy2):\/\/[^\s"'<>]+/gi;
const FETCH_URL_RE = /^https?:\/\/\S+$/i;
const BASE64_RE = /^[A-Za-z0-9+/=_\-\s]+$/;
const SUPPORTED_PROTOCOLS = ['vmess', 'vless', 'trojan', 'ss', 'hysteria2', 'tuic'];
const REGION_RULES = [
  { tag: 'hk', label: '香港', keywords: ['香港', 'hong kong', 'hk', 'hkg'] },
  { tag: 'tw', label: '台湾', keywords: ['台湾', 'taiwan', 'taipei', 'tpe', 'tw'] },
  { tag: 'jp', label: '日本', keywords: ['日本', 'japan', 'tokyo', 'osaka', 'nrt', 'kix', 'jp'] },
  { tag: 'sg', label: '新加坡', keywords: ['新加坡', 'singapore', 'sg', 'sin'] },
  { tag: 'us', label: '美国', keywords: ['美国', 'united states', 'usa', 'us', 'los angeles', 'san jose', 'seattle', 'new york', 'dallas', 'silicon valley'] },
  { tag: 'kr', label: '韩国', keywords: ['韩国', 'korea', 'seoul', 'kr', 'icn'] },
  { tag: 'uk', label: '英国', keywords: ['英国', 'united kingdom', 'uk', 'london'] },
  { tag: 'de', label: '德国', keywords: ['德国', 'germany', 'frankfurt', 'berlin', 'de'] },
  { tag: 'fr', label: '法国', keywords: ['法国', 'france', 'paris', 'fr'] },
  { tag: 'nl', label: '荷兰', keywords: ['荷兰', 'netherlands', 'amsterdam', 'nl'] },
  { tag: 'ca', label: '加拿大', keywords: ['加拿大', 'canada', 'toronto', 'vancouver', 'ca'] },
  { tag: 'au', label: '澳大利亚', keywords: ['澳大利亚', 'australia', 'sydney', 'melbourne', 'au'] },
  { tag: 'my', label: '马来西亚', keywords: ['马来西亚', 'malaysia', 'kuala lumpur', 'my'] },
  { tag: 'in', label: '印度', keywords: ['印度', 'india', 'mumbai', 'delhi', 'in'] },
  { tag: 'ru', label: '俄罗斯', keywords: ['俄罗斯', 'russia', 'moscow', 'ru'] }
];

async function convertVpnInput(inputText, options = {}) {
  const rawInput = String(inputText || '').trim();
  const warnings = [];
  const fetchedSources = [];
  const maxNodes = clampInt(options.maxNodes, 500, 1, 5000);
  const fetchText = typeof options.fetchText === 'function' ? options.fetchText : null;

  if (!rawInput) {
    return emptyResult('请输入订阅链接或原始节点');
  }

  const sourceTexts = await resolveSourceTexts(rawInput, { fetchText, warnings, fetchedSources });
  const seen = new Set();
  const parsedNodes = [];

  sourceTexts.forEach((text) => {
    const links = extractNodeLinks(text);
    links.forEach((link) => {
      if (parsedNodes.length >= maxNodes) return;
      if (seen.has(link)) return;
      seen.add(link);
      try {
        const node = parseNodeLink(link);
        if (node) parsedNodes.push(enrichNode(node));
      } catch (error) {
        warnings.push(`解析失败：${link.slice(0, 80)}${link.length > 80 ? '...' : ''} | ${error.message || error}`);
      }
    });
  });

  if (!parsedNodes.length) {
    return emptyResult('没有识别到可转换的节点', { warnings, fetchedSources });
  }

  const transform = applyNodeTransforms(parsedNodes, options);
  if (transform.duplicateRemoved > 0) {
    warnings.push(`已按规则去重 ${transform.duplicateRemoved} 个重复节点`);
  }
  if (transform.filteredOut > 0) {
    warnings.push(`已根据筛选条件过滤 ${transform.filteredOut} 个节点`);
  }

  const nodes = transform.nodes;
  const protocols = countBy(nodes, (item) => item.protocol);
  const regions = countBy(nodes, (item) => item.regionTag || 'other');
  const raw = nodes.map((node) => node.original).join('\n');
  const outputs = buildOutputs(nodes);

  const hasVisibleNodes = nodes.length > 0;
  const message = hasVisibleNodes
    ? buildSummaryMessage(parsedNodes.length, nodes.length, transform)
    : `已识别 ${parsedNodes.length} 个节点，但当前筛选条件过滤后剩 0 个`;

  return {
    ok: true,
    summary: {
      total: nodes.length,
      rawTotal: parsedNodes.length,
      protocols,
      regions,
      duplicateRemoved: transform.duplicateRemoved,
      filteredOut: transform.filteredOut,
      message
    },
    warnings,
    fetchedSources,
    nodes,
    outputs,
    meta: {
      appliedFilters: {
        dedupeMode: transform.dedupeMode,
        protocols: transform.protocols,
        region: transform.region,
        keyword: transform.keyword
      },
      supportedProtocols: SUPPORTED_PROTOCOLS,
      supportedRegions: REGION_RULES.map((item) => ({ tag: item.tag, label: item.label }))
    }
  };
}

function buildOutputs(nodes) {
  const raw = nodes.map((node) => node.original).join('\n');
  return {
    raw,
    base64: Buffer.from(raw, 'utf8').toString('base64'),
    clash: buildClashYaml(nodes),
    singbox: buildSingBoxJson(nodes),
    surge: buildSurgeConfig(nodes),
    loon: buildLoonConfig(nodes),
    quantumultx: buildQuantumultXConfig(nodes)
  };
}

function emptyResult(message, extras = {}) {
  return {
    ok: false,
    summary: {
      total: 0,
      rawTotal: 0,
      protocols: {},
      regions: {},
      duplicateRemoved: 0,
      filteredOut: 0,
      message: message || '没有输入'
    },
    warnings: Array.isArray(extras.warnings) ? extras.warnings : [],
    fetchedSources: Array.isArray(extras.fetchedSources) ? extras.fetchedSources : [],
    nodes: [],
    outputs: {
      raw: '',
      base64: '',
      clash: '',
      singbox: '',
      surge: '',
      loon: '',
      quantumultx: ''
    },
    meta: {
      appliedFilters: {
        dedupeMode: 'none',
        protocols: [],
        region: 'all',
        keyword: ''
      },
      supportedProtocols: SUPPORTED_PROTOCOLS,
      supportedRegions: REGION_RULES.map((item) => ({ tag: item.tag, label: item.label }))
    }
  };
}

async function resolveSourceTexts(rawInput, context) {
  const lines = rawInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const urls = [];
  const inlineText = [];

  lines.forEach((line) => {
    if (FETCH_URL_RE.test(line) && !NODE_SCHEME_RE.test(line)) {
      urls.push(line);
    } else {
      inlineText.push(line);
    }
  });

  const sources = [];
  if (inlineText.length) {
    sources.push(maybeDecodeSubscriptionText(inlineText.join('\n')));
  }

  if (urls.length) {
    if (!context.fetchText) {
      context.warnings.push('当前环境未启用远程抓取，已跳过订阅链接');
    } else {
      for (const url of urls) {
        try {
          const text = await context.fetchText(url);
          const normalized = maybeDecodeSubscriptionText(text);
          sources.push(normalized);
          context.fetchedSources.push({ url, ok: true, length: normalized.length });
        } catch (error) {
          context.fetchedSources.push({ url, ok: false, error: error.message || String(error) });
          context.warnings.push(`抓取订阅失败：${url} | ${error.message || error}`);
        }
      }
    }
  }

  if (!sources.length) {
    sources.push(maybeDecodeSubscriptionText(rawInput));
  }

  return sources;
}

function maybeDecodeSubscriptionText(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  if (extractNodeLinks(raw).length) return raw;
  if (!BASE64_RE.test(raw.replace(/\s+/g, ''))) return raw;
  const decoded = decodeBase64Flexible(raw);
  if (!decoded) return raw;
  if (extractNodeLinks(decoded).length) return decoded;
  return raw;
}

function extractNodeLinks(text) {
  const value = String(text || '');
  const links = value.match(NODE_SCHEME_RE) || [];
  return links.map((item) => item.replace(/[),.;]+$/, '').trim()).filter(Boolean);
}

function parseNodeLink(link) {
  const lower = String(link || '').toLowerCase();
  if (lower.startsWith('vmess://')) return parseVmess(link);
  if (lower.startsWith('vless://')) return parseVless(link);
  if (lower.startsWith('trojan://')) return parseTrojan(link);
  if (lower.startsWith('ss://')) return parseShadowsocks(link);
  if (lower.startsWith('hysteria2://') || lower.startsWith('hy2://')) return parseHysteria2(link);
  if (lower.startsWith('tuic://')) return parseTuic(link);
  throw new Error('暂不支持的协议');
}

function enrichNode(node) {
  const region = detectNodeRegion(node);
  return {
    ...node,
    regionTag: region.tag,
    regionLabel: region.label,
    searchText: [node.name, node.server, node.host, node.sni, node.path, node.original]
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
  };
}

function applyNodeTransforms(nodes, options = {}) {
  const dedupeMode = normalizeDedupeMode(options.dedupeMode ?? options.dedupe ?? 'endpoint');
  const protocols = normalizeProtocolFilter(options.protocols || options.protocolFilter);
  const region = normalizeRegionFilter(options.region || options.regionFilter);
  const keyword = String(options.keyword || '').trim().toLowerCase();

  let duplicateRemoved = 0;
  let working = Array.isArray(nodes) ? nodes.slice() : [];

  if (dedupeMode !== 'none') {
    const seen = new Set();
    const deduped = [];
    working.forEach((node) => {
      const key = buildDedupeKey(node, dedupeMode);
      if (seen.has(key)) {
        duplicateRemoved += 1;
        return;
      }
      seen.add(key);
      deduped.push(node);
    });
    working = deduped;
  }

  const beforeFilterCount = working.length;
  working = working.filter((node) => {
    if (protocols.length && !protocols.includes(node.protocol)) return false;
    if (region !== 'all' && node.regionTag !== region) return false;
    if (keyword && !String(node.searchText || '').includes(keyword)) return false;
    return true;
  });

  return {
    nodes: working,
    duplicateRemoved,
    filteredOut: Math.max(0, beforeFilterCount - working.length),
    dedupeMode,
    protocols,
    region,
    keyword
  };
}

function buildSummaryMessage(rawTotal, visibleTotal, transform) {
  const parts = [`已识别 ${visibleTotal} 个节点`];
  if (rawTotal !== visibleTotal) {
    parts.push(`原始共 ${rawTotal} 个`);
  }
  if (transform.duplicateRemoved > 0) {
    parts.push(`去重 ${transform.duplicateRemoved} 个`);
  }
  if (transform.filteredOut > 0) {
    parts.push(`筛掉 ${transform.filteredOut} 个`);
  }
  return parts.join('，');
}

function countBy(list, pickKey) {
  const out = {};
  (Array.isArray(list) ? list : []).forEach((item) => {
    const key = String(pickKey(item) || '').trim();
    if (!key) return;
    out[key] = (out[key] || 0) + 1;
  });
  return out;
}

function normalizeDedupeMode(input) {
  const value = String(input || '').trim().toLowerCase();
  if (value === 'none' || value === 'link' || value === 'endpoint') return value;
  if (value === 'true') return 'endpoint';
  return 'endpoint';
}

function normalizeProtocolFilter(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[\s,|/]+/g);
  const seen = new Set();
  const out = [];
  raw.forEach((item) => {
    const value = String(item || '').trim().toLowerCase();
    if (!SUPPORTED_PROTOCOLS.includes(value) || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  });
  return out;
}

function normalizeRegionFilter(input) {
  const value = String(input || 'all').trim().toLowerCase();
  if (!value || value === 'all') return 'all';
  if (REGION_RULES.some((item) => item.tag === value)) return value;
  return 'all';
}

function buildDedupeKey(node, mode) {
  if (mode === 'link') return String(node.original || '');
  return [
    node.protocol,
    node.server,
    node.port,
    node.uuid || node.password || '',
    node.network || '',
    node.host || '',
    node.path || '',
    node.sni || ''
  ].join('|');
}

function detectNodeRegion(node) {
  const text = [node.name, node.server, node.host, node.sni, node.path]
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');

  for (const rule of REGION_RULES) {
    if (rule.keywords.some((keyword) => text.includes(String(keyword).toLowerCase()))) {
      return { tag: rule.tag, label: rule.label };
    }
  }

  const server = String(node.server || '').trim().toLowerCase();
  const tldMatch = server.match(/\.([a-z]{2})$/i);
  if (tldMatch) {
    const tld = tldMatch[1].toLowerCase();
    const matched = REGION_RULES.find((item) => item.tag === tld);
    if (matched) return { tag: matched.tag, label: matched.label };
  }

  return { tag: 'other', label: '其他' };
}

function parseVmess(link) {
  const payload = link.slice('vmess://'.length).trim();
  const decoded = decodeBase64Flexible(payload);
  if (!decoded) throw new Error('vmess 节点 Base64 解码失败');
  let data = {};
  try {
    data = JSON.parse(decoded);
  } catch (_error) {
    throw new Error('vmess 节点 JSON 解析失败');
  }
  const server = String(data.add || data.server || '').trim();
  const port = toPort(data.port);
  const name = String(data.ps || '').trim() || `${server}:${port}`;
  if (!server || !port || !data.id) throw new Error('vmess 节点字段不完整');
  return {
    protocol: 'vmess',
    name,
    server,
    port,
    uuid: String(data.id || '').trim(),
    alterId: clampInt(data.aid, 0, 0, 99999),
    cipher: String(data.scy || 'auto').trim() || 'auto',
    network: String(data.net || 'tcp').trim() || 'tcp',
    host: String(data.host || '').trim(),
    path: String(data.path || '').trim(),
    tls: String(data.tls || '').trim().toLowerCase() === 'tls',
    sni: String(data.sni || '').trim(),
    alpn: String(data.alpn || '').trim(),
    original: link,
    meta: data
  };
}

function parseVless(link) {
  const url = new URL(link);
  const name = decodeHashName(url) || `${url.hostname}:${url.port || ''}`;
  const security = String(url.searchParams.get('security') || '').trim().toLowerCase();
  return {
    protocol: 'vless',
    name,
    server: url.hostname,
    port: toPort(url.port),
    uuid: decodeURIComponent(url.username || ''),
    network: String(url.searchParams.get('type') || 'tcp').trim() || 'tcp',
    host: String(url.searchParams.get('host') || '').trim(),
    path: String(url.searchParams.get('path') || '').trim(),
    tls: security === 'tls' || security === 'reality',
    security,
    sni: String(url.searchParams.get('sni') || url.searchParams.get('servername') || '').trim(),
    flow: String(url.searchParams.get('flow') || '').trim(),
    publicKey: String(url.searchParams.get('pbk') || '').trim(),
    shortId: String(url.searchParams.get('sid') || '').trim(),
    serviceName: String(url.searchParams.get('serviceName') || '').trim(),
    original: link,
    meta: Object.fromEntries(url.searchParams.entries())
  };
}

function parseTrojan(link) {
  const url = new URL(link);
  const name = decodeHashName(url) || `${url.hostname}:${url.port || ''}`;
  const security = String(url.searchParams.get('security') || 'tls').trim().toLowerCase();
  return {
    protocol: 'trojan',
    name,
    server: url.hostname,
    port: toPort(url.port),
    password: decodeURIComponent(url.username || ''),
    network: String(url.searchParams.get('type') || 'tcp').trim() || 'tcp',
    host: String(url.searchParams.get('host') || '').trim(),
    path: String(url.searchParams.get('path') || '').trim(),
    tls: security !== 'none',
    sni: String(url.searchParams.get('sni') || url.searchParams.get('servername') || '').trim(),
    original: link,
    meta: Object.fromEntries(url.searchParams.entries())
  };
}

function parseShadowsocks(link) {
  const raw = link.slice('ss://'.length);
  const hashIndex = raw.indexOf('#');
  const hashText = hashIndex >= 0 ? raw.slice(hashIndex + 1) : '';
  const beforeHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const queryIndex = beforeHash.indexOf('?');
  const beforeQuery = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;

  let serverPart = beforeQuery;
  let authPart = '';

  if (beforeQuery.includes('@')) {
    const atIndex = beforeQuery.lastIndexOf('@');
    authPart = beforeQuery.slice(0, atIndex);
    serverPart = beforeQuery.slice(atIndex + 1);
  } else {
    const decoded = decodeBase64Flexible(beforeQuery);
    if (!decoded || !decoded.includes('@')) throw new Error('ss 节点格式不正确');
    const atIndex = decoded.lastIndexOf('@');
    authPart = decoded.slice(0, atIndex);
    serverPart = decoded.slice(atIndex + 1);
  }

  if (!authPart.includes(':')) {
    const decoded = decodeBase64Flexible(authPart);
    if (!decoded || !decoded.includes(':')) throw new Error('ss 鉴权信息解码失败');
    authPart = decoded;
  }

  const authIndex = authPart.indexOf(':');
  const method = authPart.slice(0, authIndex);
  const password = authPart.slice(authIndex + 1);
  const { host, port } = parseHostPort(serverPart);

  return {
    protocol: 'ss',
    name: decodeTextSafe(hashText) || `${host}:${port}`,
    server: host,
    port,
    cipher: method,
    password,
    original: link,
    meta: {}
  };
}

function parseHysteria2(link) {
  const normalized = link.replace(/^hy2:\/\//i, 'hysteria2://');
  const url = new URL(normalized);
  return {
    protocol: 'hysteria2',
    name: decodeHashName(url) || `${url.hostname}:${url.port || ''}`,
    server: url.hostname,
    port: toPort(url.port),
    password: decodeURIComponent(url.username || ''),
    sni: String(url.searchParams.get('sni') || '').trim(),
    obfs: String(url.searchParams.get('obfs') || '').trim(),
    obfsPassword: String(url.searchParams.get('obfs-password') || '').trim(),
    insecure: parseBoolean(String(url.searchParams.get('insecure') || 'false')),
    upMbps: toOptionalNumber(url.searchParams.get('upmbps')),
    downMbps: toOptionalNumber(url.searchParams.get('downmbps')),
    original: link,
    meta: Object.fromEntries(url.searchParams.entries())
  };
}

function parseTuic(link) {
  const url = new URL(link);
  return {
    protocol: 'tuic',
    name: decodeHashName(url) || `${url.hostname}:${url.port || ''}`,
    server: url.hostname,
    port: toPort(url.port),
    uuid: decodeURIComponent(url.username || ''),
    password: decodeURIComponent(url.password || ''),
    sni: String(url.searchParams.get('sni') || '').trim(),
    alpn: String(url.searchParams.get('alpn') || '').trim(),
    congestionController: String(url.searchParams.get('congestion_control') || '').trim(),
    udpRelayMode: String(url.searchParams.get('udp_relay_mode') || '').trim(),
    original: link,
    meta: Object.fromEntries(url.searchParams.entries())
  };
}

function buildClashYaml(nodes) {
  const normalizedNodes = withClientNames(nodes);
  const lines = ['proxies:'];
  normalizedNodes.forEach((node) => {
    lines.push(...buildClashProxyLines(node));
  });
  lines.push('');
  lines.push('proxy-groups:');
  lines.push('  - name: NodeSelect');
  lines.push('    type: select');
  lines.push('    proxies:');
  normalizedNodes.forEach((node) => {
    lines.push(`      - ${yamlScalar(node.clientName)}`);
  });
  lines.push('      - DIRECT');
  lines.push('');
  lines.push('rules:');
  lines.push('  - MATCH,NodeSelect');
  return lines.join('\n');
}

function buildSingBoxJson(nodes) {
  const normalizedNodes = withClientNames(nodes);
  const outbounds = normalizedNodes.map((node) => buildSingBoxOutbound(node)).filter(Boolean);
  outbounds.push({ type: 'direct', tag: 'DIRECT' });
  outbounds.push({ type: 'selector', tag: 'NodeSelect', outbounds: normalizedNodes.map((node) => node.clientName).concat('DIRECT'), default: normalizedNodes[0]?.clientName || 'DIRECT' });
  const payload = {
    log: { level: 'warn' },
    outbounds,
    route: { final: 'NodeSelect', auto_detect_interface: true }
  };
  return JSON.stringify(payload, null, 2);
}

function buildSurgeConfig(nodes) {
  const normalizedNodes = withClientNames(nodes);
  const proxyLines = normalizedNodes.map((node) => buildSurgeLine(node)).filter(Boolean);
  const groupNames = normalizedNodes.map((node) => node.clientName).concat('DIRECT');
  return [
    '[Proxy]',
    ...proxyLines,
    '',
    '[Proxy Group]',
    `NodeSelect = select, ${groupNames.join(', ')}`,
    '',
    '[Rule]',
    'FINAL,NodeSelect'
  ].join('\n');
}

function buildLoonConfig(nodes) {
  const normalizedNodes = withClientNames(nodes);
  const proxyLines = normalizedNodes.map((node) => buildLoonLine(node)).filter(Boolean);
  const groupNames = normalizedNodes.map((node) => node.clientName).concat('DIRECT');
  return [
    '[Proxy]',
    ...proxyLines,
    '',
    '[Proxy Group]',
    `NodeSelect = select, ${groupNames.join(', ')}`,
    '',
    '[Rule]',
    'FINAL,NodeSelect'
  ].join('\n');
}

function buildQuantumultXConfig(nodes) {
  const normalizedNodes = withClientNames(nodes);
  const proxyLines = normalizedNodes.map((node) => buildQuantumultXLine(node)).filter(Boolean);
  return [
    '[server_local]',
    ...proxyLines,
    '',
    '[filter_local]',
    'final, NodeSelect',
    '',
    '[policy]',
    `static=NodeSelect, ${normalizedNodes.map((node) => node.clientName).concat('direct').join(', ')}`
  ].join('\n');
}

function withClientNames(nodes) {
  const names = new Set();
  return (Array.isArray(nodes) ? nodes : []).map((node, index) => ({
    ...node,
    clientName: makeUniqueName(node.name || `${node.protocol}-${index + 1}`, names)
  }));
}

function buildClashProxyLines(node) {
  const lines = [];
  const push = (level, key, value) => {
    if (value === undefined || value === null || value === '') return;
    lines.push(`${'  '.repeat(level)}${key}: ${yamlValue(value)}`);
  };

  lines.push('  - name: ' + yamlScalar(node.clientName));
  switch (node.protocol) {
    case 'vmess':
      push(2, 'type', 'vmess');
      push(2, 'server', node.server);
      push(2, 'port', node.port);
      push(2, 'uuid', node.uuid);
      push(2, 'alterId', node.alterId);
      push(2, 'cipher', node.cipher || 'auto');
      push(2, 'udp', true);
      if (node.tls) push(2, 'tls', true);
      if (node.sni) push(2, 'servername', node.sni);
      appendClashNetworkOptions(lines, node);
      break;
    case 'vless':
      push(2, 'type', 'vless');
      push(2, 'server', node.server);
      push(2, 'port', node.port);
      push(2, 'uuid', node.uuid);
      push(2, 'udp', true);
      if (node.tls) push(2, 'tls', true);
      if (node.sni) push(2, 'servername', node.sni);
      if (node.flow) push(2, 'flow', node.flow);
      appendClashRealityOptions(lines, node);
      appendClashNetworkOptions(lines, node);
      break;
    case 'trojan':
      push(2, 'type', 'trojan');
      push(2, 'server', node.server);
      push(2, 'port', node.port);
      push(2, 'password', node.password);
      push(2, 'udp', true);
      if (node.tls) push(2, 'tls', true);
      if (node.sni) push(2, 'sni', node.sni);
      appendClashNetworkOptions(lines, node);
      break;
    case 'ss':
      push(2, 'type', 'ss');
      push(2, 'server', node.server);
      push(2, 'port', node.port);
      push(2, 'cipher', node.cipher);
      push(2, 'password', node.password);
      push(2, 'udp', true);
      break;
    case 'hysteria2':
      push(2, 'type', 'hysteria2');
      push(2, 'server', node.server);
      push(2, 'port', node.port);
      push(2, 'password', node.password);
      if (node.sni) push(2, 'sni', node.sni);
      if (node.insecure) push(2, 'skip-cert-verify', true);
      if (node.obfs) push(2, 'obfs', node.obfs);
      if (node.obfsPassword) push(2, 'obfs-password', node.obfsPassword);
      if (node.upMbps) push(2, 'up', `${node.upMbps} Mbps`);
      if (node.downMbps) push(2, 'down', `${node.downMbps} Mbps`);
      break;
    case 'tuic':
      push(2, 'type', 'tuic');
      push(2, 'server', node.server);
      push(2, 'port', node.port);
      push(2, 'uuid', node.uuid);
      push(2, 'password', node.password);
      if (node.sni) push(2, 'sni', node.sni);
      if (node.alpn) push(2, 'alpn', splitList(node.alpn));
      if (node.congestionController) push(2, 'congestion-controller', node.congestionController);
      if (node.udpRelayMode) push(2, 'udp-relay-mode', node.udpRelayMode);
      break;
    default:
      push(2, 'type', node.protocol);
      push(2, 'server', node.server);
      push(2, 'port', node.port);
      break;
  }
  return lines;
}

function appendClashNetworkOptions(lines, node) {
  const push = (level, key, value) => {
    if (value === undefined || value === null || value === '') return;
    lines.push(`${'  '.repeat(level)}${key}: ${yamlValue(value)}`);
  };
  const network = String(node.network || '').trim().toLowerCase();
  if (!network || network === 'tcp') return;
  push(2, 'network', network);
  if (network === 'ws') {
    lines.push('    ws-opts:');
    push(3, 'path', node.path || '/');
    if (node.host) {
      lines.push('      headers:');
      push(4, 'Host', node.host);
    }
  }
  if (network === 'grpc') {
    lines.push('    grpc-opts:');
    push(3, 'grpc-service-name', node.serviceName || node.path || 'grpc');
  }
  if ((network === 'http' || network === 'h2') && (node.host || node.path)) {
    lines.push('    http-opts:');
    if (node.path) {
      lines.push('      path:');
      splitList(node.path, /[,|]/).forEach((item) => {
        lines.push(`        - ${yamlScalar(item || '/')}`);
      });
    }
    if (node.host) {
      lines.push('      headers:');
      lines.push('        Host:');
      splitList(node.host, /[,|]/).forEach((item) => {
        lines.push(`          - ${yamlScalar(item)}`);
      });
    }
  }
}

function appendClashRealityOptions(lines, node) {
  const security = String(node.security || '').trim().toLowerCase();
  if (security !== 'reality') return;
  lines.push('    reality-opts:');
  if (node.publicKey) lines.push(`      public-key: ${yamlScalar(node.publicKey)}`);
  if (node.shortId) lines.push(`      short-id: ${yamlScalar(node.shortId)}`);
}

function buildSingBoxOutbound(node) {
  const base = {
    type: node.protocol === 'ss' ? 'shadowsocks' : node.protocol,
    tag: node.clientName,
    server: node.server,
    server_port: node.port
  };

  if (node.protocol === 'vmess') {
    base.uuid = node.uuid;
    base.security = node.cipher || 'auto';
    base.alter_id = node.alterId || 0;
  } else if (node.protocol === 'vless') {
    base.uuid = node.uuid;
    if (node.flow) base.flow = node.flow;
  } else if (node.protocol === 'trojan') {
    base.password = node.password;
  } else if (node.protocol === 'ss') {
    base.method = node.cipher;
    base.password = node.password;
  } else if (node.protocol === 'hysteria2') {
    base.password = node.password;
    if (node.upMbps) base.up_mbps = node.upMbps;
    if (node.downMbps) base.down_mbps = node.downMbps;
    if (node.obfs) {
      base.obfs = { type: node.obfs, password: node.obfsPassword || undefined };
    }
  } else if (node.protocol === 'tuic') {
    base.uuid = node.uuid;
    base.password = node.password;
    if (node.congestionController) base.congestion_control = node.congestionController;
    if (node.udpRelayMode) base.udp_relay_mode = node.udpRelayMode;
  }

  if (node.tls || node.sni || node.protocol === 'tuic' || node.protocol === 'hysteria2' || node.protocol === 'trojan') {
    base.tls = { enabled: !!(node.tls || node.protocol === 'tuic' || node.protocol === 'hysteria2' || node.protocol === 'trojan') };
    if (node.sni) base.tls.server_name = node.sni;
    if (node.insecure) base.tls.insecure = true;
    if (node.alpn) base.tls.alpn = splitList(node.alpn);
    if (node.security === 'reality') {
      base.tls.reality = { enabled: true };
      if (node.publicKey) base.tls.reality.public_key = node.publicKey;
      if (node.shortId) base.tls.reality.short_id = node.shortId;
    }
  }

  const transport = buildSingBoxTransport(node);
  if (transport) base.transport = transport;
  return base;
}

function buildSingBoxTransport(node) {
  const network = String(node.network || '').trim().toLowerCase();
  if (!network || network === 'tcp') return null;
  if (network === 'ws') {
    return {
      type: 'ws',
      path: node.path || '/',
      headers: node.host ? { Host: node.host } : undefined
    };
  }
  if (network === 'grpc') {
    return {
      type: 'grpc',
      service_name: node.serviceName || node.path || 'grpc'
    };
  }
  if (network === 'http' || network === 'h2') {
    return {
      type: 'http',
      host: node.host ? splitList(node.host, /[,|]/) : undefined,
      path: node.path || '/'
    };
  }
  return { type: network };
}

function buildSurgeLine(node) {
  const parts = [`${node.clientName} = ${mapSurgeType(node.protocol)}`, node.server, String(node.port)];
  if (node.protocol === 'vmess') {
    parts.push(`username=${node.uuid}`);
    parts.push(`cipher=${node.cipher || 'auto'}`);
  } else if (node.protocol === 'vless') {
    parts.push(`uuid=${node.uuid}`);
  } else if (node.protocol === 'trojan') {
    parts.push(`password=${node.password}`);
  } else if (node.protocol === 'ss') {
    parts.push(`encrypt-method=${node.cipher}`);
    parts.push(`password=${node.password}`);
  } else if (node.protocol === 'hysteria2') {
    parts.push(`password=${node.password}`);
  } else if (node.protocol === 'tuic') {
    parts.push(`uuid=${node.uuid}`);
    parts.push(`password=${node.password}`);
  }
  appendCommonLineParts(parts, node, 'surge');
  return parts.join(', ');
}

function buildLoonLine(node) {
  const parts = [`${node.clientName} = ${mapLoonType(node.protocol)}`, node.server, String(node.port)];
  if (node.protocol === 'vmess') {
    parts.push(`uuid=${node.uuid}`);
    parts.push(`cipher=${node.cipher || 'auto'}`);
  } else if (node.protocol === 'vless') {
    parts.push(`uuid=${node.uuid}`);
  } else if (node.protocol === 'trojan') {
    parts.push(`password=${node.password}`);
  } else if (node.protocol === 'ss') {
    parts.push(`method=${node.cipher}`);
    parts.push(`password=${node.password}`);
  } else if (node.protocol === 'hysteria2') {
    parts.push(`password=${node.password}`);
  } else if (node.protocol === 'tuic') {
    parts.push(`uuid=${node.uuid}`);
    parts.push(`password=${node.password}`);
  }
  appendCommonLineParts(parts, node, 'loon');
  return parts.join(', ');
}

function buildQuantumultXLine(node) {
  const prefix = `${mapQuantumultType(node.protocol)}=${node.server}:${node.port}`;
  const parts = [prefix];
  if (node.protocol === 'vmess') {
    parts.push(`method=${node.cipher || 'auto'}`);
    parts.push(`password=${node.uuid}`);
  } else if (node.protocol === 'vless') {
    parts.push(`password=${node.uuid}`);
  } else if (node.protocol === 'trojan') {
    parts.push(`password=${node.password}`);
  } else if (node.protocol === 'ss') {
    parts.push(`method=${node.cipher}`);
    parts.push(`password=${node.password}`);
  } else if (node.protocol === 'hysteria2') {
    parts.push(`password=${node.password}`);
  } else if (node.protocol === 'tuic') {
    parts.push(`username=${node.uuid}`);
    parts.push(`password=${node.password}`);
  }
  appendCommonLineParts(parts, node, 'quantumultx');
  parts.push(`tag=${safeLineValue(node.clientName)}`);
  return parts.join(', ');
}

function appendCommonLineParts(parts, node, target) {
  if (node.tls) {
    if (target === 'quantumultx') {
      parts.push('over-tls=true');
    } else {
      parts.push('tls=true');
    }
  }
  if (node.sni) {
    parts.push(target === 'quantumultx' ? `tls-host=${safeLineValue(node.sni)}` : `sni=${safeLineValue(node.sni)}`);
  }
  const network = String(node.network || '').trim().toLowerCase();
  if (network === 'ws') {
    if (target === 'quantumultx') {
      parts.push(node.tls ? 'obfs=wss' : 'obfs=ws');
      if (node.host) parts.push(`obfs-host=${safeLineValue(node.host)}`);
      if (node.path) parts.push(`obfs-uri=${safeLineValue(node.path)}`);
    } else {
      parts.push('ws=true');
      if (node.host) parts.push(`ws-headers=Host:${safeLineValue(node.host)}`);
      if (node.path) parts.push(`ws-path=${safeLineValue(node.path)}`);
    }
  }
  if (network === 'grpc') {
    parts.push(target === 'quantumultx' ? 'obfs=grpc' : 'grpc=true');
    if (node.serviceName || node.path) {
      const serviceName = node.serviceName || node.path || 'grpc';
      parts.push(target === 'quantumultx' ? `obfs-uri=${safeLineValue(serviceName)}` : `grpc-service-name=${safeLineValue(serviceName)}`);
    }
  }
  if ((network === 'http' || network === 'h2') && node.host) {
    parts.push(target === 'quantumultx' ? `obfs-host=${safeLineValue(node.host)}` : `host=${safeLineValue(node.host)}`);
  }
  if (node.protocol === 'hysteria2') {
    if (node.obfs) parts.push(`obfs=${safeLineValue(node.obfs)}`);
    if (node.obfsPassword) parts.push(`obfs-password=${safeLineValue(node.obfsPassword)}`);
    if (node.insecure) parts.push(target === 'quantumultx' ? 'tls-verification=false' : 'skip-cert-verify=true');
  }
  if (node.protocol === 'tuic') {
    if (node.alpn) parts.push(`alpn=${safeLineValue(splitList(node.alpn).join('|'))}`);
    if (node.congestionController) parts.push(`congestion-controller=${safeLineValue(node.congestionController)}`);
  }
}

function mapSurgeType(protocol) {
  if (protocol === 'ss') return 'ss';
  if (protocol === 'hysteria2') return 'hysteria2';
  return protocol;
}

function mapLoonType(protocol) {
  if (protocol === 'ss') return 'shadowsocks';
  return protocol;
}

function mapQuantumultType(protocol) {
  if (protocol === 'ss') return 'shadowsocks';
  return protocol;
}

function makeUniqueName(name, seen) {
  const base = String(name || 'Node').trim() || 'Node';
  let candidate = base;
  let index = 2;
  while (seen.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  seen.add(candidate);
  return candidate;
}

function yamlValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => yamlScalar(item)).join(', ')}]`;
  }
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return yamlScalar(value);
}

function yamlScalar(value) {
  const text = String(value ?? '');
  if (/^[A-Za-z0-9_.:/@+-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function safeLineValue(value) {
  return String(value ?? '').replace(/,/g, '\\,');
}

function parseHostPort(input) {
  const text = String(input || '').trim();
  const lastColon = text.lastIndexOf(':');
  if (lastColon <= 0) throw new Error('host:port 格式错误');
  return {
    host: text.slice(0, lastColon),
    port: toPort(text.slice(lastColon + 1))
  };
}

function decodeHashName(url) {
  return decodeTextSafe(String(url.hash || '').replace(/^#/, '').trim());
}

function decodeTextSafe(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch (_error) {
    return raw;
  }
}

function decodeBase64Flexible(input) {
  try {
    const compact = String(input || '').trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    if (!compact) return '';
    const pad = compact.length % 4 === 0 ? compact : compact + '='.repeat(4 - (compact.length % 4));
    return Buffer.from(pad, 'base64').toString('utf8').trim();
  } catch (_error) {
    return '';
  }
}

function splitList(value, pattern = /[,;]/) {
  return String(value || '')
    .split(pattern)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toPort(value) {
  const port = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) throw new Error('端口无效');
  return port;
}

function toOptionalNumber(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

module.exports = {
  convertVpnInput
};
