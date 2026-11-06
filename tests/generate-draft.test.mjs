import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { draftErrorCode, generateDraft, parseDraftRequest, runDraft } from "../scripts/generate-draft.mjs";
import { extractSenses, lookupDictionary } from "../scripts/draft-dictionary.mjs";
import { validateData } from "../assets/model.js";

const input = { terms: ["routed", "signals"], sentence: "  We routed the signals.\nKeep the original spacing.  ",
  source: "实验教材", detailed: false };
const now = new Date("2026-11-01T20:00:00Z");
const library = { entries: [{ tags: ["网络"], reviewTags: ["易混词"], personalExamples: [{ exampleTags: ["教材例句"] }] }] };

function record(term) {
  return [{ word: term, phonetics: [{ text: "/" + term + "/" }], license: { name: "CC BY-SA 3.0" },
    sourceUrls: ["https://example.invalid/not-a-source", "https://en.wiktionary.org/wiki/" + term],
    meanings: [{ partOfSpeech: "verb", definitions: [
      { definition: "A verified dictionary definition." },
      { definition: "A second verified sense.", example: "An example actually returned by the dictionary." },
    ] }] }];
}

function modelWord(term) {
  return { term, phonetic: "/model-ipa/", tags: ["网络"], reviewTags: ["易混词"], exampleTags: ["网络", "教材例句", "定语从句"],
    notes: "词级笔记。", partOfSpeech: "verb", definitionEn: "An original definition.", definitionZh: "原创学习释义。",
    examples: [{ en: "An independent learning example.", zh: "原创例句翻译。" }],
    contextAnalysis: "该词在原句中的含义与作用。", dictionary: { index: 1, fit: "contextual", definitionEn: "FAKE DICTIONARY TEXT",
      url: "https://fake.invalid", exampleEn: "FAKE DICTIONARY EXAMPLE", definitionZh: "义项的翻译。", exampleZh: "词典例句的翻译。" } };
}

const grammar = { structure: "We / routed / the signals.", parts: [{ label: "We", explanation: "主语。" }],
  core: "We routed signals.", rewrite: "We sent the signals along a chosen path." };

function mock({ dictionary = (word) => record(word), mutate = () => {}, completion = "stop", fail = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.startsWith("https://api.dictionaryapi.dev/")) {
      assert.equal(options.headers.Authorization, undefined);
      const word = decodeURIComponent(url.split("/").pop());
      const records = dictionary(word);
      return records instanceof Response ? records : Response.json(records);
    }
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    if (fail) throw new Error("SECRET-PRIVATE-PAYLOAD");
    const posted = JSON.parse(options.body);
    assert.deepEqual(posted.response_format, { type: "json_object" });
    assert.equal(posted.model, "deepseek-flash");
    const context = JSON.parse(posted.messages[1].content);
    assert.equal(context.sentence, input.sentence);
    assert.deepEqual(context.knownTags.tags, ["网络"]);
    const object = { words: context.terms.map(modelWord), translation: "我们为这些信号选择了传输路径。", grammarAnalysis: grammar };
    mutate(object);
    return Response.json({ choices: [{ finish_reason: completion, message: { content: JSON.stringify(object) } }] });
  };
  return { fetchImpl, calls, apiKey: "test-key", now, data: library };
}

test("creates independent editable entries from one shared model request; only verified dictionary content survives", async () => {
  const options = mock({ dictionary: (word) => word === "routed" ? new Response(null, { status: 404 }) :
    word === "rout" ? new Response(null, { status: 404 }) : record(word) });
  const draft = await generateDraft(input, options);
  assert.deepEqual(draft.entries.map((e) => e.term), input.terms);
  assert.deepEqual(draft.warnings, []);
  assert.equal(validateData({ schemaVersion: 1, updatedAt: now.toISOString(), entries: draft.entries }).valid, true);
  assert.equal(options.calls.filter((c) => c.url.startsWith("https://api.deepseek.com/")).length, 1);
  for (const entry of draft.entries) {
    const [ai, actual] = entry.definitions;
    assert.match(ai.dictionary, /DeepSeek/);
    assert.equal(ai.url, "");
    assert.equal(ai.examples[0].en, "An independent learning example.");
    assert.equal(actual.definitionEn, "A second verified sense.");
    assert.equal(actual.examples[0].en, "An example actually returned by the dictionary.");
    assert.match(actual.dictionary, /Wiktionary.*CC BY-SA 3.0.*中文为 AI 翻译/);
    assert.match(actual.url, /^https:\/\/en\.wiktionary\.org\/wiki\//);
    assert.deepEqual(entry.tags, ["网络"]);
    assert.deepEqual(entry.reviewTags, ["易混词"]);
    assert.equal(entry.personalExamples[0].en, input.sentence);
    assert.equal(entry.personalExamples[0].encounteredAt, "2026-11-02");
    assert.deepEqual(entry.personalExamples[0].exampleTags, ["网络", "教材例句"]);
    assert.equal(entry.personalExamples[0].note, "");
    assert.equal(entry.personalExamples[0].contextAnalysis, "");
    assert.deepEqual(entry.personalExamples[0].grammarAnalysis, { structure: "", parts: [], core: "", rewrite: "" });
  }
  assert.equal(draft.entries[0].definitions[1].url, "https://en.wiktionary.org/wiki/route");
  assert.equal(draft.entries[0].phonetic, "/model-ipa/"); // Lemma IPA is not inflected-form IPA.
  assert.equal(draft.entries[1].phonetic, "/signals/");
  assert.equal(draft.entries[0].personalExamples[0].zh, draft.entries[1].personalExamples[0].zh);
  assert.notEqual(draft.entries[0].personalExamples[0].id, draft.entries[1].personalExamples[0].id);
});

test("detailed mode shares a complete grammar analysis and keeps word-specific context", async () => {
  const options = mock({ mutate: (value) => { value.words[1].contextAnalysis = "该词在此是宾语。"; } });
  const { entries } = await generateDraft({ ...input, detailed: true }, options);
  assert.deepEqual(entries[0].personalExamples[0].grammarAnalysis, grammar);
  assert.deepEqual(entries[1].personalExamples[0].grammarAnalysis, grammar);
  assert.equal(entries[1].personalExamples[0].contextAnalysis, "该词在此是宾语。");
  assert.ok(entries[1].personalExamples[0].exampleTags.includes("定语从句"));
});

test("missing sourced senses or missing real examples never create invented dictionary text", async () => {
  const options = mock({ dictionary: (term) => term === "routed" ? record(term) : new Response(null, { status: 429 }),
    mutate: (r) => { r.words[0].dictionary.index = 0; } });
  const draft = await generateDraft(input, options);
  assert.deepEqual(draft.entries[0].definitions[1].examples, []);
  assert.equal(draft.entries[1].definitions.length, 1);
  assert.match(draft.warnings[0], /signals.*Wiktionary/);
});

test("preserves a sourced general sense and its real example when the model cannot select a contextual sense", async () => {
  const dictionary = (word) => {
    const rows = record(word);
    rows[0].meanings[0].definitions.shift();
    return rows;
  };
  const { entries, warnings } = await generateDraft(input, mock({ dictionary, mutate: (r) => {
    r.words[0].dictionary = null;
    r.words[1].dictionary.index = 0;
    r.words[1].dictionary.fit = "general";
  } }));
  for (const entry of entries) {
    assert.equal(entry.definitions.length, 2);
    const card = entry.definitions[1];
    assert.match(card.dictionary, /CC BY-SA 3.0.*通用义项（语境用法见AI）/);
    assert.equal(card.definitionEn, "A second verified sense.");
    assert.equal(card.examples[0].en, "An example actually returned by the dictionary.");
    assert.equal(card.url, "https://en.wiktionary.org/wiki/" + entry.term);
  }
  assert.equal(entries[0].definitions[1].definitionZh, "");
  assert.equal(entries[0].definitions[1].examples[0].zh, "");
  assert.match(warnings[0], /routed.*中文翻译/);
  assert.equal(entries[1].definitions[1].definitionZh, "义项的翻译。");
  assert.match(entries[1].definitions[1].dictionary, /中文为 AI 翻译/);
});

test("ordinary examples fall back to at most two topic tags after filtering analysis and unverified source tags", async () => {
  const { entries } = await generateDraft({ ...input, source: "" }, mock({ mutate: (r) => {
    r.words[0].tags = ["定语从句", "网络", "通信", "设备"];
    r.words[0].exampleTags = ["定语从句", "教材例句"];
  } }));
  assert.deepEqual(entries[0].personalExamples[0].exampleTags, ["网络", "通信"]);
});

test("dictionary rejects unverifiable sources and never retries an HTTP 429", async () => {
  const records = record("signal");
  records[0].sourceUrls = ["https://en.wiktionary.org.evil.invalid/wiki/signal",
    "https://en.wiktionary.org/wiki/another", "javascript:void(0)"];
  assert.deepEqual(extractSenses(records, "signal"), []);
  let calls = 0;
  const senses = await lookupDictionary("signals", async () => { calls++; return new Response(null, { status: 429 }); });
  assert.deepEqual(senses, []);
  assert.equal(calls, 1);
});

test("plural fallback matches lemmas and preserves exact Wiktionary links", async () => {
  const result = await lookupDictionary("batches", async (url) => url.endsWith("/batch") ?
    Response.json(record("batch")) : new Response(null, { status: 404 }));
  assert.equal(result[0].form, "batch");
  assert.equal(result[0].url, "https://en.wiktionary.org/wiki/batch");
  const ambiguous = await lookupDictionary("routed", async (url) => url.endsWith("/routed") ?
    new Response(null, { status: 404 }) : Response.json(record(url.split("/").pop())));
  assert.deepEqual([...new Set(ambiguous.map((sense) => sense.form))], ["rout", "route"]);
});

test("rejects invalid input, incomplete results, missing examples, missing analyses and invalid source selection", async () => {
  for (const patch of [{ terms: [] }, { terms: ["UP", "up"] }, { terms: ["../secret"] }, { terms: ["one\ntwo"] },
    { terms: Array.from({ length: 9 }, (_, i) => "term" + i) }, { sentence: "" }, { detailed: "yes" }]) {
    assert.throws(() => parseDraftRequest({ ...input, ...patch }));
  }
  for (const mutate of [
    (r) => r.words.pop(), (r) => { r.words[1].term = "wrong"; },
    (r) => { r.words[0].tags = []; },
    (r) => { r.grammarAnalysis.core = ""; }, (r) => { r.grammarAnalysis.rewrite = ""; },
    (r) => { r.words[0].examples[0].zh = ""; }, (r) => { r.words[0].dictionary.index = 50; },
  ]) await assert.rejects(generateDraft({ ...input, detailed: true }, mock({ mutate })));
  await assert.rejects(generateDraft(input, mock({ completion: "length" })), /输出未完成/);
  await assert.rejects(generateDraft(input, mock({ fail: true })), (e) => !e.message.includes("SECRET"));
});

test("failed run produces no draft and successful run cannot overwrite existing files", async (t) => {
  const root = os.tmpdir();
  const folder = await mkdtemp(path.join(root, "vocabulary-draft-"));
  t.after(() => {
    assert.equal(path.dirname(folder), path.resolve(root));
    assert.ok(path.basename(folder).startsWith("vocabulary-draft-"));
    return rm(folder, { recursive: true, force: true });
  });
  const target = path.join(folder, "draft.json");
  const env = { DRAFT_REQUEST: JSON.stringify(input), DRAFT_PATH: target, DEEPSEEK_API_KEY: "test-key" };
  await assert.rejects(runDraft(env, mock({ fail: true })));
  assert.deepEqual(await readdir(folder), []);
  await runDraft(env, mock());
  assert.equal(JSON.parse(await readFile(target)).entries.length, 2);
  await writeFile(target, "existing");
  await assert.rejects(runDraft(env, mock()), { code: "EEXIST" });
  assert.equal(await readFile(target, "utf8"), "existing");
});

test("reports only stable public error codes for failed providers or missing credentials", async () => {
  const options = mock();
  const failures = [[401, "AUTH"], [403, "AUTH"], [402, "BALANCE"], [429, "RATE_LIMIT"],
    [504, "TIMEOUT"], [500, "GENERATION_FAILED"]];
  for (const [status, code] of failures) {
    const fetchImpl = (url, init) => url.startsWith("https://api.deepseek.com/") ?
      new Response("private provider body", { status }) : options.fetchImpl(url, init);
    await assert.rejects(generateDraft(input, { ...options, fetchImpl }), (error) => draftErrorCode(error) === code);
  }
  await assert.rejects(generateDraft(input, { ...options, apiKey: "" }), (error) => draftErrorCode(error) === "MISSING_KEY");
  await assert.rejects(generateDraft(input, mock({ mutate: (r) => r.words.pop() })), (error) => draftErrorCode(error) === "INVALID_RESPONSE");
  assert.equal(draftErrorCode(new Error("SECRET")), "GENERATION_FAILED");
});
