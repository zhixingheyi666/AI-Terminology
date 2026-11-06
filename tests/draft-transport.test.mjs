import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { validateDraftInput, matchesDraftCheck, decodeDraftResponse, generateDraft } from "../assets/draft-client.js";
import { validateDispatch, encodeDraft, returnDraft } from "../scripts/return-draft.mjs";

const ID = "b81c9917-c05a-4e1e-aed4-447ff7495d75";
const SHA = "a".repeat(40);
const key = randomBytes(32).toString("base64");
const input = { terms: ["grounding"], sentence: "The model uses grounding. $(echo secret) <script>", source: "Book", detailed: false };
const routing = { repository: "Owner/AI-Terminology", requestId: ID, headSha: SHA, key, request: input };
const draft = { entries: [{ term: "grounding", notes: "事实依据。" }], warnings: [] };
const env = { GITHUB_EVENT_NAME: "repository_dispatch", GITHUB_REPOSITORY: routing.repository,
  GITHUB_ACTOR: "Owner", GITHUB_TRIGGERING_ACTOR: "Owner", GITHUB_SHA: SHA, GITHUB_TOKEN: "github-token-test",
  DEEPSEEK_API_KEY: "deepseek-test-key" };
function event() { return { action: "vocabulary-draft", repository: { full_name: routing.repository },
  sender: { login: "Owner" }, client_payload: { version: 1, request_id: ID, head_sha: SHA, key, request: input } }; }
function check(text, values = {}) { return { name: `vocabulary-draft-${ID}`, external_id: ID, head_sha: SHA,
  app: { slug: "github-actions" }, status: "completed", conclusion: "success", output: { text }, ...values }; }
async function cryptoKey(value = key) {
  return crypto.subtle.importKey("raw", Buffer.from(value, "base64"), "AES-GCM", false, ["decrypt"]);
}
async function fixture(t) {
  const parent = path.dirname(fileURLToPath(import.meta.url));
  const directory = await mkdtemp(path.join(parent, ".draft-transport-test-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), parent);
    assert.ok(path.basename(directory).startsWith(".draft-transport-test-"));
    await rm(directory, { recursive: true, force: true });
  });
  const eventPath = path.join(directory, "event.json");
  await writeFile(eventPath, JSON.stringify(event()));
  return { ...env, GITHUB_EVENT_PATH: eventPath, RUNNER_TEMP: directory };
}

test("draft transport validates input bounds and keeps user text as data", () => {
  assert.deepEqual(validateDraftInput(input), input);
  for (const value of [null, { ...input, terms: [] }, { ...input, terms: Array(9).fill("word") },
    { ...input, sentence: " " }, { ...input, sentence: "x".repeat(10001) },
    { ...input, terms: ["one\ntwo"] }, { ...input, detailed: "yes" }]) {
    assert.throws(() => validateDraftInput(value));
  }
});

test("dispatch requires owner identities and a validated private reply channel", () => {
  assert.deepEqual(validateDispatch(event(), env), routing);
  for (const property of ["GITHUB_ACTOR", "GITHUB_TRIGGERING_ACTOR", "GITHUB_REPOSITORY", "GITHUB_EVENT_NAME"]) {
    assert.throws(() => validateDispatch(event(), { ...env, [property]: "outsider" }));
  }
  for (const edit of [
    (e) => { e.sender.login = "outsider"; }, (e) => { e.action = "other"; },
    (e) => { e.client_payload.key = "not-a-key"; }, (e) => { e.client_payload.head_sha = "main"; },
    (e) => { e.client_payload.request_id += "\noutput=1"; }, (e) => { e.client_payload.version = 2; },
  ]) { const request = event(); edit(request); assert.throws(() => validateDispatch(request, env)); }
});

test("encrypted response interoperates with WebCrypto and binds repo, request and SHA", async () => {
  const text = encodeDraft(draft, routing);
  assert.doesNotMatch(text, /grounding|事实依据|deepseek|model uses/);
  const options = { key: await cryptoKey(), repository: routing.repository, requestId: ID, headSha: SHA };
  assert.deepEqual(await decodeDraftResponse(text, options), draft);
  await assert.rejects(decodeDraftResponse(text, { ...options, key: await cryptoKey(randomBytes(32).toString("base64")) }), /验证失败/);
  await assert.rejects(decodeDraftResponse(text, { ...options, repository: "Owner/another" }), /验证失败/);
  await assert.rejects(decodeDraftResponse(text, { ...options, headSha: "b".repeat(40) }), /验证失败/);
  await assert.rejects(decodeDraftResponse(text, { ...options, requestId: "another" }), /不匹配/);
});

test("check response must come from GitHub Actions for the specific request and commit", () => {
  assert.equal(matchesDraftCheck(check(""), ID, SHA), true);
  assert.equal(matchesDraftCheck(check("", { app: { slug: "other" } }), ID, SHA), false);
  assert.equal(matchesDraftCheck(check("", { external_id: "other" }), ID, SHA), false);
  assert.equal(matchesDraftCheck(check("", { head_sha: "b".repeat(40) }), ID, SHA), false);
});

test("safe errors give useful feedback while unknown server content stays hidden", async () => {
  const cases = { MISSING_KEY: /DEEPSEEK_API_KEY/, AUTH: /密钥无效/, BALANCE: /余额不足/, RATE_LIMIT: /频繁/, TIMEOUT: /超时/,
    MODEL_TRUNCATED: /长度限制/, MODEL_JSON: /JSON/, MODEL_FORMAT: /结构/, TERM_MISMATCH: /拼写/,
    WORD_FIELDS: /释义/, SHARED_TRANSLATION: /原句翻译/, GRAMMAR_FIELDS: /详细语法/ };
  for (const [error, message] of Object.entries(cases)) {
    await assert.rejects(decodeDraftResponse(JSON.stringify({ version: 1, request_id: ID, error }), { requestId: ID }), message);
  }
  await assert.rejects(decodeDraftResponse(JSON.stringify({ version: 1, request_id: ID, error: "PRIVATE-MODEL-TEXT" }), { requestId: ID }), /后台起草任务/);
});

test("backend runs generator with minimal env, publishes ciphertext only, and removes the temporary draft", async (t) => {
  const settings = await fixture(t);
  const calls = [];
  const githubImpl = async (url, token, options) => {
    assert.equal(token, env.GITHUB_TOKEN);
    calls.push({ url, options });
    return options?.method === "POST" ? { id: 1 } : { check_runs: [] };
  };
  const spawnImpl = (_command, args, options) => {
    assert.ok(args[0].endsWith("generate-draft.mjs"));
    assert.equal(options.env.GITHUB_TOKEN, undefined);
    assert.equal(options.env.GITHUB_EVENT_PATH, undefined);
    assert.equal(options.env.key, undefined);
    assert.deepEqual(JSON.parse(options.env.DRAFT_REQUEST), input);
    // The production process is synchronous; use a completed process stub here.
    return { status: 0, stderr: "", stdout: "safe count" };
  };
  // Simulate the generator file result at exactly the private, controlled path.
  const file = path.join(settings.RUNNER_TEMP, `vocabulary-draft-${ID}.json`);
  await writeFile(file, JSON.stringify(draft));
  assert.deepEqual(await returnDraft({ env: settings, githubImpl, spawnImpl }), { success: true });
  const post = JSON.parse(calls.find((call) => call.options?.method === "POST").options.body);
  assert.equal(post.head_sha, SHA);
  assert.equal(post.conclusion, "success");
  assert.doesNotMatch(JSON.stringify(post), /事实依据|The model|deepseek-test-key/);
  assert.deepEqual(await decodeDraftResponse(post.output.text, { key: await cryptoKey(),
    repository: routing.repository, requestId: ID, headSha: SHA }), draft);
  assert.deepEqual(await readdir(settings.RUNNER_TEMP), ["event.json"]);
});

test("backend maps only fixed child-process error codes and never returns raw stderr", async (t) => {
  const settings = await fixture(t);
  const codes = ["AUTH", "MODEL_TRUNCATED", "MODEL_JSON", "MODEL_FORMAT", "TERM_MISMATCH", "WORD_FIELDS", "SHARED_TRANSLATION", "GRAMMAR_FIELDS"];
  const errorCases = codes.map(code => [`DRAFT_ERROR:${code}\n`, code]);
  for (const [stderr, expected] of [...errorCases, ["DRAFT_ERROR:MODEL_JSON\nsecret model text", "GENERATION_FAILED"]]) {
    let post;
    const githubImpl = async (_url, _token, options) => {
      if (options?.method === "POST") { post = JSON.parse(options.body); return {}; }
      return { check_runs: [] };
    };
    await returnDraft({ env: settings, githubImpl, spawnImpl: () => ({ status: 1, stderr }) });
    assert.equal(post.conclusion, "failure");
    assert.equal(JSON.parse(post.output.text).error, expected);
    assert.doesNotMatch(JSON.stringify(post), /secret model text/);
  }
});

test("partial check results privately count every requested word, in order", async (t) => {
  const settings = await fixture(t);
  const request = event();
  const requestedTerms = ["privateAlpha", "privateBeta", "privateGamma"];
  request.client_payload.request = { ...input, terms: requestedTerms };
  await writeFile(settings.GITHUB_EVENT_PATH, JSON.stringify(request));
  const partial = { entries: [{ term: requestedTerms[0] }, { term: requestedTerms[2] }],
    warnings: ["private warning"], missingTerms: [requestedTerms[1]] };
  const options = { key: await cryptoKey(), repository: routing.repository, requestId: ID, headSha: SHA, requestedTerms };
  async function deliver(value) {
    let publicCheck;
    await writeFile(path.join(settings.RUNNER_TEMP, `vocabulary-draft-${ID}.json`), JSON.stringify(value));
    await returnDraft({ env: settings,
      githubImpl: async (_url, _token, data) => {
        if (data?.method === "POST") { publicCheck = JSON.parse(data.body); return {}; }
        return { check_runs: [] };
      }, spawnImpl: () => ({ status: 0, stdout: "private model text", stderr: "" }) });
    assert.doesNotMatch(JSON.stringify(publicCheck), /privateAlpha|privateBeta|privateGamma|private warning|private model text|The model uses/);
    return publicCheck;
  }
  const post = await deliver(partial);
  assert.equal(post.conclusion, "success");
  assert.deepEqual(await decodeDraftResponse(post.output.text, options), partial);
  for (const invalid of [
    { ...partial, missingTerms: undefined }, { ...partial, missingTerms: ["foreign"] },
    { ...partial, entries: partial.entries.toReversed() }, { ...partial, missingTerms: [requestedTerms[0]] },
    { ...partial, entries: [], missingTerms: requestedTerms }, { ...partial, missingTerms: null },
  ]) {
    const rejected = await deliver(invalid);
    assert.deepEqual(JSON.parse(rejected.output.text), { version: 1, request_id: ID, error: "TERM_MISMATCH" });
    await assert.rejects(decodeDraftResponse(encodeDraft(invalid, routing), options), /清单与请求不符/);
  }
});

test("backend avoids repeated paid generation and returns missing-key or stale-version errors", async (t) => {
  const settings = await fixture(t);
  let calls = 0;
  assert.deepEqual(await returnDraft({ env: settings, githubImpl: async () => ({ check_runs: [check("")] }),
    spawnImpl: () => { calls++; } }), { alreadyComplete: true });
  assert.equal(calls, 0);
  for (const [changes, expected] of [[{ DEEPSEEK_API_KEY: "" }, "MISSING_KEY"], [{ GITHUB_SHA: "b".repeat(40) }, "STALE_HEAD"]]) {
    let post;
    await returnDraft({ env: { ...settings, ...changes }, githubImpl: async (_u, _t, options) => {
      if (options?.method === "POST") { post = JSON.parse(options.body); return {}; }
      return { check_runs: [] };
    }, spawnImpl: () => { calls++; } });
    assert.equal(JSON.parse(post.output.text).error, expected);
  }
  assert.equal(calls, 0);
});

test("browser authenticates owner, dispatches privately, and decrypts only its matching check", async (t) => {
  let payload;
  let publicChecksReads = 0;
  const paths = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    paths.push(String(url));
    if (url.endsWith("/user")) return Response.json({ login: "Owner" });
    if (url.endsWith("/repos/Owner/AI-Terminology")) return Response.json({ owner: { login: "Owner" }, full_name: routing.repository, default_branch: "main", private: false });
    if (url.endsWith("/commits/main")) return Response.json({ sha: SHA });
    if (url.endsWith("/dispatches")) {
      payload = JSON.parse(options.body).client_payload;
      assert.deepEqual(payload.request, input);
      return new Response(null, { status: 204 });
    }
    if (url.includes("/check-runs?")) {
      if (options.headers.Authorization) return new Response(null, { status: 403 });
      publicChecksReads++;
      if (!payload) return Response.json({ check_runs: [] });
      const route = { ...routing, requestId: payload.request_id, key: payload.key };
      return Response.json({ check_runs: [check(encodeDraft(draft, route), {
        name: `vocabulary-draft-${payload.request_id}`, external_id: payload.request_id,
      })] });
    }
    throw new Error("Unexpected API route");
  });
  const result = await generateDraft({ owner: "Owner", repo: "AI-Terminology", branch: "other" }, "test-token", input);
  assert.deepEqual(result, draft);
  assert.ok(publicChecksReads >= 2);
  assert.ok(!paths.some((value) => value.includes("issues")));
});

test("browser blocks duplicate submissions and cancellation releases the pending request", async (t) => {
  const controller = new AbortController();
  let started;
  const waiting = new Promise((resolve) => { started = resolve; });
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    started();
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  });
  const settings = { owner: "Owner", repo: "AI-Terminology" };
  const pending = generateDraft(settings, "test", input, { signal: controller.signal });
  await waiting;
  await assert.rejects(generateDraft(settings, "test", input), /已有草稿/);
  controller.abort();
  await assert.rejects(pending, (error) => error.name === "AbortError");
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(generateDraft(settings, "test", input, { signal: cancelled.signal }),
    (error) => error.name === "AbortError");
});

test("browser reports missing credentials and cancellation before sending any request", async () => {
  await assert.rejects(generateDraft({ owner: "Owner", repo: "AI-Terminology" }, "", input), /GitHub 令牌/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(generateDraft({ owner: "Owner", repo: "AI-Terminology" }, "test", input,
    { signal: controller.signal }), (error) => error.name === "AbortError");
});
