import { readFile, unlink, stat } from "node:fs/promises";
import { createCipheriv, randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDraftInput, checkDraftCoverage } from "../assets/draft-client.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40}$/;
const SAFE_ERRORS = new Set(["MISSING_KEY", "AUTH", "BALANCE", "RATE_LIMIT", "TIMEOUT", "INVALID_RESPONSE", "GENERATION_FAILED",
  "MODEL_TRUNCATED", "MODEL_JSON", "MODEL_FORMAT", "TERM_MISMATCH", "WORD_FIELDS", "SHARED_TRANSLATION", "GRAMMAR_FIELDS"]);

export function validateDispatch(event, env) {
  const repository = env.GITHUB_REPOSITORY;
  if (typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("INVALID_EVENT");
  const owner = repository.split("/")[0].toLowerCase();
  if (env.GITHUB_EVENT_NAME !== "repository_dispatch" || event?.action !== "vocabulary-draft" ||
      event?.repository?.full_name?.toLowerCase() !== repository.toLowerCase() ||
      [event?.sender?.login, env.GITHUB_ACTOR, env.GITHUB_TRIGGERING_ACTOR].some((name) =>
        typeof name !== "string" || name.toLowerCase() !== owner)) throw new Error("INVALID_EVENT");
  const payload = event.client_payload;
  if (payload?.version !== 1 || !UUID.test(payload.request_id || "") || !SHA.test(payload.head_sha || "") ||
      typeof payload.key !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(payload.key) ||
      Buffer.from(payload.key, "base64").length !== 32) throw new Error("INVALID_EVENT");
  return { repository, requestId: payload.request_id, headSha: payload.head_sha, key: payload.key,
    request: payload.request };
}

export function encodeDraft(result, routing) {
  const bytes = Buffer.from(JSON.stringify(result));
  if (bytes.length > 512000) throw new Error("OUTPUT_TOO_LARGE");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(routing.key, "base64"), iv);
  cipher.setAAD(Buffer.from(JSON.stringify({ version: 1, repository: routing.repository.toLowerCase(),
    request_id: routing.requestId, head_sha: routing.headSha })));
  const ciphertext = Buffer.concat([cipher.update(gzipSync(bytes)), cipher.final(), cipher.getAuthTag()]);
  const text = JSON.stringify({ version: 1, request_id: routing.requestId, encoding: "gzip+aes-256-gcm",
    iv: iv.toString("base64"), ciphertext: ciphertext.toString("base64") });
  if (text.length > 63000) throw new Error("OUTPUT_TOO_LARGE");
  return text;
}

function errorText(code, routing) {
  return JSON.stringify({ version: 1, request_id: routing.requestId, error: code });
}
async function github(pathname, token, options = {}) {
  const response = await fetch(`https://api.github.com${pathname}`, { ...options, redirect: "error",
    signal: AbortSignal.timeout(25000), headers: { Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" } });
  if (!response.ok) throw new Error("GITHUB_FAILED");
  return response.json();
}

export async function publishDraft(text, routing, env, success, githubImpl = github) {
  if (!env.GITHUB_TOKEN) throw new Error("GITHUB_FAILED");
  const name = `vocabulary-draft-${routing.requestId}`;
  const root = `/repos/${routing.repository.split("/").map(encodeURIComponent).join("/")}`;
  return githubImpl(`${root}/check-runs`, env.GITHUB_TOKEN, { method: "POST", body: JSON.stringify({
    name, head_sha: routing.headSha, external_id: routing.requestId, status: "completed",
    conclusion: success ? "success" : "failure", completed_at: new Date().toISOString(),
    output: { title: "Vocabulary draft", summary: success ? "Encrypted draft ready for the requesting browser." : "Draft generation did not complete.", text },
  }) });
}

export async function returnDraft({ env = process.env, githubImpl = github, spawnImpl = spawnSync } = {}) {
  // Event data is read inside Node. Never interpolate the request or its key into a
  // workflow run command, YAML env block, log, output, summary, artifact or commit.
  if (!env.GITHUB_EVENT_PATH || !env.RUNNER_TEMP) throw new Error("INVALID_EVENT");
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, "utf8"));
  const routing = validateDispatch(event, env);
  const root = `/repos/${routing.repository.split("/").map(encodeURIComponent).join("/")}`;
  const previous = await githubImpl(`${root}/commits/${routing.headSha}/check-runs?check_name=${encodeURIComponent(`vocabulary-draft-${routing.requestId}`)}&filter=latest&per_page=100`, env.GITHUB_TOKEN);
  if (previous?.check_runs?.some((check) => check.name === `vocabulary-draft-${routing.requestId}` &&
      check.external_id === routing.requestId && check.head_sha === routing.headSha &&
      check.app?.slug === "github-actions" && check.status === "completed")) return { alreadyComplete: true };
  const directory = path.resolve(env.RUNNER_TEMP);
  const draftPath = path.join(directory, `vocabulary-draft-${routing.requestId}.json`);
  let text;
  let success = false;
  try {
    if (env.GITHUB_SHA !== routing.headSha) throw new Error("STALE_HEAD");
    let request;
    try { request = validateDraftInput(routing.request); } catch { throw new Error("INVALID_REQUEST"); }
    if (!env.DEEPSEEK_API_KEY) throw new Error("MISSING_KEY");
    const result = spawnImpl(process.execPath, [fileURLToPath(new URL("./generate-draft.mjs", import.meta.url))], {
      env: { DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY, DEEPSEEK_MODEL: env.DEEPSEEK_MODEL || "deepseek-flash",
        DRAFT_REQUEST: JSON.stringify(request), DRAFT_PATH: draftPath,
        ...(process.platform === "win32" && env.SystemRoot ? { SystemRoot: env.SystemRoot } : {}) },
      stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 180000, maxBuffer: 128000,
    });
    if (result.error?.code === "ETIMEDOUT" || result.signal) throw new Error("TIMEOUT");
    if (result.error || result.status !== 0) {
      const code = /^DRAFT_ERROR:([A-Z_]+)\s*$/u.exec(result.stderr || "")?.[1];
      throw new Error(SAFE_ERRORS.has(code) ? code : "GENERATION_FAILED");
    }
    if ((await stat(draftPath)).size > 512000) throw new Error("OUTPUT_TOO_LARGE");
    const draft = JSON.parse(await readFile(draftPath, "utf8"));
    try { checkDraftCoverage(draft, request.terms); } catch { throw new Error("TERM_MISMATCH"); }
    text = encodeDraft(draft, routing);
    success = true;
  } catch (error) {
    const code = [...SAFE_ERRORS, "STALE_HEAD", "OUTPUT_TOO_LARGE", "INVALID_REQUEST"].includes(error.message)
      ? error.message : "GENERATION_FAILED";
    text = errorText(code, routing);
  } finally { await unlink(draftPath).catch(() => {}); }
  await publishDraft(text, routing, env, success, githubImpl);
  return { success };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await returnDraft();
    console.log(result.alreadyComplete ? "Draft request was already completed." : "Draft response delivered.");
  } catch {
    console.error("Draft response could not be delivered; no learning text was logged.");
    process.exitCode = 1;
  }
}
