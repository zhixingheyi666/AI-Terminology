import test from "node:test";
import assert from "node:assert/strict";
import { lookupDictionary } from "../scripts/draft-dictionary.mjs";
import { lookupOfflineWordnet } from "../scripts/offline-wordnet.mjs";
import { generateDraft } from "../scripts/generate-draft.mjs";

function record(form, definitionEn, partOfSpeech = "noun") {
  return [{ word: form, phonetic: "", sourceUrls: [`https://en.wiktionary.org/wiki/${form.replaceAll(" ", "_")}`],
    license: { name: "CC BY-SA 3.0" }, meanings: [{ partOfSpeech, definitions: [{ definition: definitionEn }] }] }];
}

test("online compound spelling fallback verifies the real headword and keeps its own source", async () => {
  const requests = [];
  const senses = await lookupDictionary("machine-learning", async (url) => {
    const term = decodeURIComponent(url.split("/").at(-1)); requests.push(term);
    return term === "machine learning" ? Response.json(record("machine learning", "A field of study in artificial intelligence."))
      : new Response(null, { status: 404 });
  });
  assert.deepEqual(requests, ["machine-learning", "machine learning"]);
  assert.equal(senses.length, 1);
  assert.equal(senses[0].form, "machine learning");
  assert.equal(senses[0].url, "https://en.wiktionary.org/wiki/machine_learning");
});

test("weak cross-reference entries do not suppress a verified open-compound lookup", async () => {
  const requests = [];
  const senses = await lookupDictionary("machine-learning", async (url) => {
    const term = decodeURIComponent(url.split("/").at(-1)); requests.push(term);
    return Response.json(term === "machine-learning"
      ? record(term, "Alternative spelling of machine learning.")
      : record(term, "A field of study in artificial intelligence."));
  });
  assert.deepEqual(requests, ["machine-learning", "machine learning"]);
  assert.deepEqual(senses.map((sense) => sense.form), ["machine-learning", "machine learning"]);
  assert.ok(senses[0].url.endsWith("machine-learning"));
  assert.ok(senses[1].url.endsWith("machine_learning"));
});

test("a substantive exact compound wins, and unmatched API records are never relabelled", async () => {
  let calls = 0;
  const exact = await lookupDictionary("machine-learning", async () => {
    calls++; return Response.json(record("machine-learning", "A genuine exact headword definition."));
  });
  assert.equal(calls, 1);
  assert.equal(exact[0].form, "machine-learning");
  const rejected = await lookupDictionary("machine-learning", async (url) =>
    url.endsWith("machine-learning") ? Response.json(record("machine learning", "A different returned spelling."))
      : new Response(null, { status: 404 }));
  assert.deepEqual(rejected, []);
  let limitedCalls = 0;
  assert.deepEqual(await lookupDictionary("machine-learning", async () => {
    limitedCalls++; return new Response(null, { status: 429 });
  }), []);
  assert.equal(limitedCalls, 1);
});

test("local compound fallback preserves verified OEWN lemma and handles separators", async () => {
  for (const term of ["machine-learning", "machine learning", "machine_learning", "machine\u2011learning"]) {
    const senses = await lookupOfflineWordnet(term);
    assert.equal(senses.length, 1);
    assert.equal(senses[0].form, "machine learning");
    assert.equal(senses[0].partOfSpeech, "noun");
    assert.match(senses[0].definitionEn, /algorithms that can learn from and make predictions on data/);
    assert.equal(senses[0].url, "https://en-word.net/view/lemma/machine%20learning");
  }
  assert.deepEqual(await lookupOfflineWordnet("nonexistent-compound-qzxv"), []);
});

function generatedWord(term, choice) {
  return { term, phonetic: "", partOfSpeech: "noun", definitionEn: "A specialized style of language or jargon.",
    definitionZh: "某个领域的行话或表达方式。", examples: [{ en: "The manual is full of technical speak.", zh: "手册里充满了技术行话。" }],
    notes: "这里把 speak 当作名词，表示行话。", tags: ["词汇"], reviewTags: [], exampleTags: ["词汇"], dictionary: choice };
}

test("invalid or inapplicable sense indices keep the verified source and discard all bound text", async () => {
  for (const index of [null, -1, "0", "not applicable", 5000, undefined]) {
    const choice = { index, fit: "contextual", definitionZh: "POISON_TRANSLATION", exampleZh: "POISON_EXAMPLE",
      usage: "POISON_USAGE", basic: { index: 0, definitionZh: "POISON_BASIC" },
      common: [{ index: 1, definitionZh: "POISON_COMMON" }] };
    const draft = await generateDraft({ terms: ["speak"], sentence: "This is technical speak.", source: "", detailed: false },
      { apiKey: "test-only-not-real", data: { entries: [] }, fetchImpl: async (url) => {
        if (url.includes("dictionaryapi.dev")) return new Response(null, { status: 404 });
        assert.equal(url, "https://api.deepseek.com/chat/completions");
        return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
          translation: "这是技术行话。", words: [generatedWord("speak", choice)],
        }) } }] });
      } });
    assert.equal(draft.entries.length, 1);
    const [dictionary, ai] = draft.entries[0].definitions;
    assert.match(dictionary.dictionary, /Open English WordNet 2025/);
    assert.equal(dictionary.partOfSpeech, "verb");
    assert.equal(dictionary.definitionZh, "");
    assert.equal(dictionary.senseGuide.fit, "general");
    assert.match(dictionary.senseGuide.usage, /领域的行话/);
    assert.ok(dictionary.senseGuide.senses.every((sense) => sense.definitionZh === ""));
    assert.equal(ai.partOfSpeech, "noun");
    assert.match(ai.definitionZh, /行话/);
    assert.doesNotMatch(JSON.stringify(draft), /POISON_/);
    assert.ok(draft.warnings.some((warning) => warning.includes("未提供有效的词典义项编号")));
  }
});

test("compound recovery does not change the submitted target spelling in the vocabulary draft", async () => {
  const draft = await generateDraft({ terms: ["machine-learning"], sentence: "This is machine-learning software.", source: "", detailed: false },
    { apiKey: "test-only-not-real", data: { entries: [] }, fetchImpl: async (url) => {
      if (url.includes("dictionaryapi.dev")) return new Response(null, { status: 502 });
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        translation: "这是机器学习软件。", words: [{ ...generatedWord("machine-learning", { index: 0, fit: "contextual",
          definitionZh: "研究可从数据学习并预测的算法的计算机科学分支。", exampleZh: "", usage: "这里作软件的定语。" }),
        partOfSpeech: "noun", definitionEn: "Learning patterns from data.", definitionZh: "从数据中学习模式。" }],
      }) } }] });
    } });
  assert.equal(draft.entries[0].term, "machine-learning");
  assert.match(draft.entries[0].definitions[0].dictionary, /machine learning/);
  assert.equal(draft.entries[0].definitions[0].url, "https://en-word.net/view/lemma/machine%20learning");
});

test("malformed optional dictionary translations or usage cannot invalidate a valid vocabulary word", async () => {
  const draft = await generateDraft({ terms: ["speak"], sentence: "This is technical speak.", source: "", detailed: false },
    { apiKey: "test-only-not-real", data: { entries: [] }, fetchImpl: async (url) => {
      if (url.includes("dictionaryapi.dev")) return new Response(null, { status: 404 });
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        translation: "这是技术行话。", words: [generatedWord("speak", { index: 0, fit: "general",
          definitionZh: { bad: "value" }, exampleZh: ["bad"], usage: "x".repeat(1501),
          basic: { index: 0, definitionZh: ["bad"] }, common: [{ index: 1, definitionZh: { bad: true } }] })],
      }) } }] });
    } });
  const dictionary = draft.entries[0].definitions[0];
  assert.equal(dictionary.definitionZh, "");
  assert.equal(dictionary.examples[0]?.zh ?? "", "");
  assert.match(dictionary.senseGuide.usage, /领域的行话/);
  assert.ok(dictionary.senseGuide.senses.every((sense) => typeof sense.definitionZh === "string"));
  assert.ok(draft.warnings.some((warning) => warning.includes("格式无效")));
});
