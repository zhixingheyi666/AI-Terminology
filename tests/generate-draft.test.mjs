import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
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
      url: "https://fake.invalid", exampleEn: "FAKE DICTIONARY EXAMPLE", definitionZh: "义项的翻译。", exampleZh: "词典例句的翻译。",
      usage: "本句中指为信号选择传输路径。", basic: { index: 0, definitionZh: "基本义翻译。" }, common: [] } };
}

const grammar = { structure: "We / routed / the signals.", parts: [{ label: "We", explanation: "主语。" }],
  core: "We routed signals.", rewrite: "We sent the signals along a chosen path." };

function mock({ dictionary = (word) => record(word), mutate = () => {}, completion = "stop", fail = false, expectedSentence = input.sentence } = {}) {
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
    assert.equal(context.sentence, expectedSentence);
    assert.deepEqual(context.knownTags.tags, ["网络"]);
    const object = { words: context.terms.map(modelWord), translation: "我们为这些信号选择了传输路径。", grammarAnalysis: grammar };
    mutate(object, context);
    return Response.json({ choices: [{ finish_reason: completion, message: { content: JSON.stringify(object) } }] });
  };
  return { fetchImpl, calls, apiKey: "test-key", lookupOfflineWordnet: async () => [], now, data: library };
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
    const [actual, ai] = entry.definitions;
    assert.match(ai.dictionary, /DeepSeek/);
    assert.equal(ai.url, "");
    assert.equal(ai.examples[0].en, "An independent learning example.");
    assert.equal(actual.definitionEn, "A second verified sense.");
    assert.equal(actual.examples[0].en, "An example actually returned by the dictionary.");
    assert.match(actual.dictionary, /Wiktionary.*CC BY-SA 3.0.*中文为 AI 翻译/);
    assert.match(actual.url, /^https:\/\/en\.wiktionary\.org\/wiki\//);
    assert.equal(actual.senseGuide.sentence, input.sentence);
    assert.equal(actual.senseGuide.usage, "本句中指为信号选择传输路径。");
    assert.equal(actual.senseGuide.alsoBasic, false);
    assert.equal(actual.senseGuide.fit, "contextual");
    assert.deepEqual(actual.senseGuide.senses.map((s) => [s.role, s.definitionZh]), [["basic", "基本义翻译。"]]);
    assert.deepEqual(entry.tags, ["网络"]);
    assert.deepEqual(entry.reviewTags, ["易混词"]);
    assert.equal(entry.personalExamples[0].en, input.sentence);
    assert.equal(entry.personalExamples[0].encounteredAt, "2026-11-02");
    assert.deepEqual(entry.personalExamples[0].exampleTags, ["网络", "教材例句"]);
    assert.equal(entry.personalExamples[0].note, "");
    assert.equal(entry.personalExamples[0].contextAnalysis, "");
    assert.deepEqual(entry.personalExamples[0].grammarAnalysis, { structure: "", parts: [], core: "", rewrite: "" });
  }
  assert.equal(draft.entries[0].definitions[0].url, "https://en.wiktionary.org/wiki/route");
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
  assert.deepEqual(draft.entries[0].definitions[0].examples, []);
  assert.equal(draft.entries[1].definitions.length, 1);
  assert.ok(draft.warnings.some((warning) => /signals.*Wiktionary/.test(warning)));
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
    const card = entry.definitions[0];
    assert.match(card.dictionary, /CC BY-SA 3.0/);
    assert.equal(card.senseGuide.fit, "general");
    assert.ok(card.senseGuide.usage);
    assert.equal(card.senseGuide.alsoBasic, true);
    assert.deepEqual(card.senseGuide.senses, []);
    assert.equal(card.definitionEn, "A second verified sense.");
    assert.equal(card.examples[0].en, "An example actually returned by the dictionary.");
    assert.equal(card.url, "https://en.wiktionary.org/wiki/" + entry.term);
  }
  assert.equal(entries[0].definitions[0].definitionZh, "");
  assert.equal(entries[0].definitions[0].examples[0].zh, "");
  assert.match(warnings[0], /routed.*中文翻译/);
  assert.equal(entries[1].definitions[0].definitionZh, "义项的翻译。");
  assert.match(entries[1].definitions[0].dictionary, /中文为 AI 翻译/);
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

test("ranks contextual, basic and common by verified indices while preserving all other distinct senses", async () => {
  const dictionary = (term) => {
    const rows = record(term);
    const definitions = Array.from({ length: 63 }, (_, i) => ({ definition: "Verified meaning " + i }));
    definitions[51].definition = "Keep the original spacing between letters.";
    definitions.push({ ...definitions[4] });
    rows[0].meanings[0].definitions = definitions;
    return rows;
  };
  const options = mock({ dictionary, mutate: (r, context) => {
    const visible = context.dictionarySensesInTermOrder[0];
    assert.ok(visible.length <= 24 && visible.some((sense) => sense.index === 51));
    for (const word of r.words) Object.assign(word.dictionary, {
      index: 51, basic: { index: 4, definitionZh: "基本义" },
      other: [{ index: 5, definitionZh: "折叠义译文" }, { index: 999, definitionZh: "伪造" }],
      common: [{ index: 51, definitionZh: "重复首义" }, { index: 4, definitionZh: "重复基本义" },
        { index: 6, definitionZh: "常见义一", definitionEn: "ignore this" }, { index: 2, definitionZh: "常见义二" }],
    });
  } });
  const { entries, warnings } = await generateDraft(input, options);
  const card = entries[0].definitions[0];
  assert.deepEqual(warnings, []);
  assert.equal(card.definitionEn, "Keep the original spacing between letters.");
  assert.deepEqual(card.senseGuide.senses.slice(0, 3).map((s) => [s.role, s.definitionEn, s.definitionZh]), [
    ["basic", "Verified meaning 4", "基本义"], ["common", "Verified meaning 6", "常见义一"], ["common", "Verified meaning 2", "常见义二"],
  ]);
  assert.equal(card.senseGuide.senses.length, 62);
  assert.ok(card.senseGuide.senses.slice(3).every((s) => s.role === "other"));
  assert.equal(card.senseGuide.senses.find((s) => s.definitionEn === "Verified meaning 5").definitionZh, "折叠义译文");
  assert.equal(new Set([card.definitionEn, ...card.senseGuide.senses.map((s) => s.definitionEn)]).size, 63);
});

test("does not mix homographs from different lemma pages, even if the model cites another form", async () => {
  const options = mock({ dictionary: (term) => {
    if (term === "routed") return new Response(null, { status: 404 });
    const records = record(term);
    for (const sense of records[0].meanings[0].definitions) sense.definition = term + ":" + sense.definition;
    return records;
  }, mutate: (r) => {
    Object.assign(r.words[0].dictionary, { index: 3, basic: { index: 0, definitionZh: "错误词形的译文" },
      common: [{ index: 1, definitionZh: "错误词形的译文" }] });
  } });
  const { entries } = await generateDraft(input, options);
  const card = entries[0].definitions[0];
  assert.equal(card.url, "https://en.wiktionary.org/wiki/route");
  assert.ok(card.definitionEn.startsWith("route:"));
  assert.equal(card.senseGuide.senses.length, 1);
  assert.ok(card.senseGuide.senses[0].definitionEn.startsWith("route:"));
  assert.equal(card.senseGuide.senses[0].definitionZh, "");
});

test("when the primary is basic, fills both remaining common slots despite invalid or duplicate suggestions", async () => {
  const options = mock({ dictionary: (term) => {
    const rows = record(term);
    rows[0].meanings[0].definitions = [0, 1, 2, 3, 4].map((i) => ({ definition: "Meaning " + i }));
    return rows;
  }, mutate: (r) => {
    for (const word of r.words) Object.assign(word.dictionary, { index: 0, basic: { index: 0, definitionZh: "基本义" },
      common: [{ index: 0, definitionZh: "不要重复" }, { index: 999, definitionZh: "无效" }, { index: 3, definitionZh: "常见义" }] });
  } });
  const { entries } = await generateDraft(input, options);
  const guide = entries[0].definitions[0].senseGuide;
  assert.equal(guide.alsoBasic, true);
  assert.deepEqual(guide.senses.map((s) => [s.role, s.definitionEn, s.definitionZh]), [
    ["common", "Meaning 3", "常见义"], ["common", "Meaning 1", ""], ["other", "Meaning 2", ""], ["other", "Meaning 4", ""],
  ]);
});

test("uses a locally sourced WordNet guide on network misses and preserves older response formats", async () => {
  const options = mock({ dictionary: () => new Response(null, { status: 503 }), mutate: (r) => {
    for (const word of r.words) {
      delete word.dictionary.basic;
      delete word.dictionary.common;
      delete word.dictionary.usage;
      word.dictionary.fit = "general";
    }
  } });
  options.lookupOfflineWordnet = async (term) => [1, 2, 3, 4, 5].map((i) => ({
    form: term, partOfSpeech: "noun", definitionEn: "Local definition " + i, example: "Local example " + i,
    phonetic: "", provider: "wordnet", sourceName: "Open English WordNet 2025",
    url: "https://en-word.net/lemma/" + term, license: "CC BY 4.0 · Open English WordNet · derived from Princeton WordNet",
  }));
  const { entries } = await generateDraft(input, options);
  const card = entries[0].definitions[0];
  assert.match(card.dictionary, /Open English WordNet 2025.*CC BY 4.0.*Princeton/);
  assert.doesNotMatch(card.dictionary, /Wiktionary/);
  assert.equal(card.definitionEn, "Local definition 2");
  assert.equal(card.examples[0].en, "Local example 2");
  assert.equal(card.senseGuide.fit, "general");
  assert.match(card.senseGuide.usage, /原创学习释义/);
  assert.deepEqual(card.senseGuide.senses.map((s) => s.role), ["basic", "common", "common", "other"]);
});

test("safety limits trim only folded senses and disclose the link to the complete dictionary", async () => {
  const terms = ["one", "two", "three", "four"];
  const options = mock({ dictionary: (term) => {
    const records = record(term);
    records[0].meanings[0].definitions = Array.from({ length: 300 }, (_, i) => ({
      definition: term + ":" + i + " " + "content ".repeat(140),
    }));
    return records;
  } });
  const draft = await generateDraft({ ...input, terms }, options);
  assert.ok(Buffer.byteLength(JSON.stringify(draft)) < 512000);
  assert.ok(draft.warnings.some((s) => s.includes("256")));
  assert.ok(draft.warnings.some((s) => s.includes("传输上限")));
  for (const entry of draft.entries) {
    assert.equal(entry.definitions[0].senseGuide.senses[0].role, "basic");
    assert.equal(entry.personalExamples[0].en, input.sentence);
  }
});

test("offers the actual WordNet base verb when online grasping only returns a surface adjective", async () => {
  const sentence = "She is grasping the concepts.";
  const options = mock({ expectedSentence: sentence, dictionary: (term) => {
    const rows = record(term);
    rows[0].meanings = [{ partOfSpeech: "adjective", definitions: [{ definition: "Greedy; eager for wealth." }] }];
    return rows;
  }, mutate: (r, context) => {
    const candidates = context.dictionarySensesInTermOrder[0];
    const verb = candidates.find((s) => s.provider === "wordnet" && s.form === "grasp" &&
      s.partOfSpeech === "verb" && s.definitionEn === "get the meaning of something");
    assert.ok(verb && candidates.some((s) => s.form === "grasping" && s.partOfSpeech === "adjective"));
    Object.assign(r.words[0].dictionary, { index: verb.index, definitionZh: "领会事物的意义。",
      exampleZh: verb.example ? "例句的中文翻译。" : "", usage: "grasping 在这里表示理解概念。" });
  } });
  delete options.lookupOfflineWordnet; // Read the real bundled database, with no external requests.
  const { entries } = await generateDraft({ terms: ["grasping"], sentence, source: "", detailed: false }, options);
  const card = entries[0].definitions[0];
  assert.equal(entries[0].term, "grasping");
  assert.equal(card.definitionEn, "get the meaning of something");
  assert.equal(card.url, "https://en-word.net/view/lemma/grasp");
  assert.match(card.dictionary, /Open English WordNet 2025.*Princeton/);
  assert.ok(card.senseGuide.senses.every((s) => !/greedy|eager for wealth/i.test(s.definitionEn)));
});

test("assigns merged online inflection records to a base lemma only after verifying them on its page", async () => {
  const senses = await lookupDictionary("grasping", async (url) => {
    const term = url.split("/").pop();
    const rows = record(term);
    if (term === "grasping") {
      rows[0].sourceUrls.push("https://en.wiktionary.org/wiki/grasp");
      rows[0].meanings.push({ partOfSpeech: "adjective", definitions: [{ definition: "Greedy." }] });
    }
    return Response.json(rows);
  });
  assert.equal(senses.filter((s) => s.form === "grasping").length, 1);
  assert.equal(senses.find((s) => s.form === "grasping").definitionEn, "Greedy.");
  assert.equal(senses.filter((s) => s.form === "grasp" && s.url.endsWith("/wiki/grasp")).length, 2);
});

test("incompressible dictionary text conforms to the encrypted result limit even below the raw file limit", async () => {
  const options = mock({ dictionary: (term) => {
    const rows = record(term);
    rows[0].meanings[0].definitions = Array.from({ length: 130 }, (_, i) => ({
      definition: Array.from({ length: 12 }, (_, j) =>
        createHash("sha256").update([term, i, j].join("-")).digest("base64")).join(" "),
    }));
    return rows;
  } });
  const draft = await generateDraft(input, options);
  assert.ok(draft.warnings.some((s) => s.includes("传输上限")));
  assert.ok(gzipSync(Buffer.from(JSON.stringify(draft))).length <= 46800);
  assert.ok(draft.entries.every((e) => e.definitions[0].senseGuide.senses.length > 3));
  assert.ok(draft.entries.every((e) => e.definitions[0].senseGuide.senses.filter((s) => s.role === "common").length === 2));
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
