const API = "https://api.github.com";
const API_VERSION = "2022-11-28";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40}$/;
const activeRequests = new Set();
const MAX_RESPONSE_BYTES = 512000;
const ERROR_MESSAGES = Object.freeze({
  MISSING_KEY: "仓库尚未配置 DEEPSEEK_API_KEY，请先在 Actions Secrets 中添加。",
  AUTH: "DeepSeek 密钥无效或没有调用权限，请检查仓库密钥。",
  BALANCE: "DeepSeek 账户余额不足，请充值后重试。",
  RATE_LIMIT: "DeepSeek 请求过于频繁，请稍后重试。",
  TIMEOUT: "DeepSeek 生成超时，请稍后重试。",
  INVALID_RESPONSE: "AI 返回的数据不完整，请重新生成。",
  GENERATION_FAILED: "AI 起草失败，请稍后重试。",
  WORKFLOW_FAILED: "后台起草任务未能完成，请检查 GitHub Actions 后重试。",
  STALE_HEAD: "等待期间仓库已更新，请重新生成草稿。",
  OUTPUT_TOO_LARGE: "草稿内容过大，请减少单词数量或缩短原句后重试。",
  INVALID_REQUEST: "起草请求格式无效，请检查单词和英文原句。",
});

function abortError() {
  return new DOMException("已取消等待；已提交的后台任务可能仍会完成。", "AbortError");
}
function checkAbort(signal) { if (signal?.aborted) throw abortError(); }
function stringField(value, max, required = false) {
  if (typeof value !== "string" || value.length > max || (required && !value.trim()) ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
    throw new Error("请检查输入内容：单词、英文原句或出处为空、过长或包含无效字符。");
  }
  return value;
}

export function validateDraftInput(input) {
  if (!input || !Array.isArray(input.terms) || input.terms.length < 1 || input.terms.length > 8 ||
      typeof input.detailed !== "boolean") throw new Error("每次请输入 1–8 个单词。");
  const terms = input.terms.map((value) => stringField(value, 120, true).trim());
  if (terms.some((term) => /[\r\n]/u.test(term))) throw new Error("每个单词应单独填写，不能包含换行。");
  const result = { terms, sentence: stringField(input.sentence, 10000, true),
    source: stringField(input.source ?? "", 1500), detailed: input.detailed };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 30000) {
    throw new Error("本次输入过长，请缩短原句后重试。");
  }
  return result;
}

function base64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function bytes64(text, max) {
  if (typeof text !== "string" || text.length > max || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) {
    throw new Error("后台草稿的加密格式无效，请重新生成。");
  }
  try { return Uint8Array.from(atob(text), (char) => char.charCodeAt(0)); }
  catch { throw new Error("后台草稿的加密格式无效，请重新生成。"); }
}
function aad(repository, requestId, headSha) {
  return new TextEncoder().encode(JSON.stringify({ version: 1, repository: repository.toLowerCase(),
    request_id: requestId, head_sha: headSha }));
}

export function matchesDraftCheck(check, requestId, headSha) {
  return check?.name === `vocabulary-draft-${requestId}` && check?.external_id === requestId &&
    check?.head_sha === headSha && check?.app?.slug === "github-actions";
}

export async function decodeDraftResponse(text, { key, repository, requestId, headSha }) {
  if (typeof text !== "string" || text.length > 64000) throw new Error("后台草稿返回过大，请减少单词后重试。");
  let envelope;
  try { envelope = JSON.parse(text); } catch { throw new Error("后台草稿格式无效，请重新生成。"); }
  if (envelope?.version !== 1 || envelope.request_id !== requestId) throw new Error("后台草稿与本次请求不匹配。");
  if (envelope.error) throw new Error(ERROR_MESSAGES[envelope.error] || ERROR_MESSAGES.WORKFLOW_FAILED);
  if (envelope.encoding !== "gzip+aes-256-gcm") throw new Error("后台草稿加密版本不兼容，请刷新页面。");
  const iv = bytes64(envelope.iv, 20);
  if (iv.length !== 12) throw new Error("后台草稿的加密格式无效。");
  let compressed;
  try {
    compressed = await crypto.subtle.decrypt({ name: "AES-GCM", iv,
      additionalData: aad(repository, requestId, headSha), tagLength: 128 }, key,
    bytes64(envelope.ciphertext, 63000));
  } catch { throw new Error("草稿验证失败，请重新生成；当前返回无法安全读取。"); }
  const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error("large"); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!Array.isArray(result.entries) || !result.entries.length || result.entries.length > 8 ||
        !Array.isArray(result.warnings) || result.warnings.some((warning) => typeof warning !== "string")) {
      throw new Error("shape");
    }
    return result;
  } catch { throw new Error("后台草稿内容不完整或过大，请重新生成。"); }
  finally { reader.releaseLock(); }
}

async function githubRequest(path, { token = "", signal, method = "GET", body } = {}) {
  checkAbort(signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 25000);
  let response;
  try {
    response = await fetch(`${API}${path}`, { method, redirect: "error", cache: "no-store",
      signal: controller.signal, headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": API_VERSION,
        ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch {
    checkAbort(signal);
    throw new Error("连接 GitHub 失败或超时，请检查网络后重试。");
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  return response;
}
async function jsonResponse(response, context) {
  if (!response.ok) {
    if (response.status === 401) throw new Error("GitHub 令牌无效或已过期，请在同步设置中更新。");
    if (response.status === 403 || response.status === 429) {
      if (response.headers.get("x-ratelimit-remaining") === "0" || response.status === 429) {
        throw new Error("GitHub 请求次数已达上限，请稍后重试。");
      }
      throw new Error(`${context}：GitHub 令牌权限不足，请检查仓库权限。`);
    }
    if (response.status === 404) throw new Error(`${context}：仓库或分支不可访问，请检查同步设置和令牌。`);
    throw new Error(`${context}（GitHub ${response.status}），请稍后重试。`);
  }
  try { return await response.json(); } catch { throw new Error(`${context}：GitHub 返回格式异常。`); }
}
function wait(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    checkAbort(signal);
    const done = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(done, milliseconds);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(abortError()); };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function generateDraft(settings, token, input, { onProgress = () => {}, signal } = {}) {
  const owner = settings?.owner;
  const repo = settings?.repo;
  if (typeof owner !== "string" || typeof repo !== "string" ||
      !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("请先在同步设置中填写 GitHub 仓库。");
  }
  if (!token || typeof token !== "string") throw new Error("请先在同步设置中填写 GitHub 令牌（仓库 Contents：读写）。");
  if (!globalThis.crypto?.subtle || typeof DecompressionStream === "undefined") {
    throw new Error("此浏览器暂不支持加密草稿，请使用新版 Chrome 或 Edge，并通过 HTTPS 打开网页。");
  }
  const request = validateDraftInput(input);
  const repository = `${owner}/${repo}`;
  const activeKey = repository.toLowerCase();
  if (activeRequests.has(activeKey)) throw new Error("已有草稿正在生成，请等待完成或取消后重试。");
  activeRequests.add(activeKey);
  let keyBytes;
  try {
    checkAbort(signal);
    onProgress("正在检查 GitHub 连接…");
    const user = await jsonResponse(await githubRequest("/user", { token, signal }), "读取账号失败");
    if (user?.login?.toLowerCase() !== owner.toLowerCase()) throw new Error("仅仓库所有者账号可以生成 AI 草稿，请使用该账号的令牌。");
    const root = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const metadata = await jsonResponse(await githubRequest(root, { token, signal }), "读取仓库失败");
    if (metadata?.owner?.login?.toLowerCase() !== owner.toLowerCase() || metadata?.full_name?.toLowerCase() !== repository.toLowerCase()) {
      throw new Error("GitHub 仓库身份不匹配，请检查同步设置。");
    }
    const branch = metadata.default_branch;
    if (typeof branch !== "string" || !branch) throw new Error("无法读取仓库默认分支。");
    const head = await jsonResponse(await githubRequest(`${root}/commits/${encodeURIComponent(branch)}`, { token, signal }), "读取分支失败");
    const headSha = head?.sha;
    if (!SHA.test(headSha || "")) throw new Error("无法读取仓库版本，请稍后重试。");
    const requestId = crypto.randomUUID();
    if (!UUID.test(requestId)) throw new Error("无法建立本次草稿请求。");
    const checksPath = `${root}/commits/${headSha}/check-runs?check_name=${encodeURIComponent(`vocabulary-draft-${requestId}`)}&filter=latest&per_page=100`;
    let checksToken = token;
    async function readChecks() {
      let response = await githubRequest(checksPath, { token: checksToken, signal });
      if ((response.status === 403 || response.status === 404) && metadata.private === false && checksToken) {
        checksToken = "";
        response = await githubRequest(checksPath, { signal });
      }
      if (!response.ok && (response.status === 403 || response.status === 404) && metadata.private !== false) {
        throw new Error("读取草稿需要 GitHub 令牌的 Checks：只读权限，请更新令牌。");
      }
      return jsonResponse(response, "读取草稿失败");
    }
    await readChecks(); // Discover permission problems before spending DeepSeek credits.
    keyBytes = crypto.getRandomValues(new Uint8Array(32));
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    onProgress("正在提交 AI 起草请求…");
    const dispatch = await githubRequest(`${root}/dispatches`, { token, signal, method: "POST",
      body: { event_type: "vocabulary-draft", client_payload: { version: 1, request_id: requestId,
        head_sha: headSha, key: base64(keyBytes), request } } });
    if (dispatch.status !== 204) {
      await jsonResponse(dispatch, "提交草稿失败（需要 Contents：读写权限）");
      throw new Error("GitHub 未确认收到草稿请求，请稍后重试。");
    }
    onProgress("后台正在生成草稿，通常需要一至几分钟…");
    for (let attempt = 0; attempt < 45; attempt++) {
      await wait(attempt === 0 ? 3000 : 12000, signal);
      const checks = await readChecks();
      if (!Array.isArray(checks?.check_runs)) throw new Error("GitHub 草稿状态格式异常，请重试。");
      const check = checks.check_runs.find((value) => matchesDraftCheck(value, requestId, headSha) && value.status === "completed");
      if (!check) continue;
      checkAbort(signal);
      const result = await decodeDraftResponse(check.output?.text, { key, repository, requestId, headSha });
      checkAbort(signal);
      if (check.conclusion !== "success") throw new Error(ERROR_MESSAGES.WORKFLOW_FAILED);
      onProgress("草稿已生成，请检查后保存。");
      return result;
    }
    throw new Error("等待草稿超时。请检查仓库是否已启用 draft.yml 工作流，以及 Actions 的运行状态后重试。");
  } finally { keyBytes?.fill(0); activeRequests.delete(activeKey); }
}
