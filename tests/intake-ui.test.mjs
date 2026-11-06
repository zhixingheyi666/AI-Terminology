import test from "node:test";
import assert from "node:assert/strict";
import { createEntry, createGrammarAnalysis, createPersonalExample } from "../assets/model.js";
import { entriesForSave, groupGuideSenses, mergeRepair, orderedDefinitions, parseTargetTerms, prepareDraft } from "../assets/intake-ui.js";

test("target input preserves phrases and hyphens across mixed separators", () => {
  assert.deepEqual(parseTargetTerms('fine-tuning FINE-TUNING，pace、"language model";\n“context window”'),
    ["fine-tuning", "pace", "language model", "context window"]);
  assert.throws(() => parseTargetTerms('“missing quote'), /引号/);
  assert.throws(() => parseTargetTerms("a b c d e f g h i"), /8/);
  assert.throws(() => parseTargetTerms("x".repeat(121)), /120/);
});

function fixture(detailed) {
  const shared = { en: "Our final sentence.", zh: "核对后的共享译文。", source: "Chapter 1",
    encounteredAt: "2026-11-03", grammarAnalysis: createGrammarAnalysis({ structure: "主语 + 谓语",
      parts: [{ label: "主语", explanation: "Our final sentence" }] }) };
  const entries = ["final", "sentence"].map(term => createEntry({ term, definitions: [
    { dictionary: "DeepSeek（AI 生成，待核对）", definitionZh: "说明" },
    { dictionary: "测试词典", url: "https://example.org/word", definitionEn: "An original meaning." },
  ], personalExamples: [createPersonalExample({ en: "Unedited sentence.", zh: "初稿",
    exampleTags: [term], note: "个人例句笔记", contextAnalysis: "语境 " + term })] }));
  return { shared, entries, detailed };
}

test("save uses shared corrections while keeping each word's examples and tags separate", () => {
  const draft = fixture(false);
  const entries = entriesForSave(draft);
  assert.notEqual(entries[0].personalExamples[0].id, entries[1].personalExamples[0].id);
  for (const entry of entries) {
    const ex = entry.personalExamples[0];
    assert.equal(ex.en, draft.shared.en);
    assert.equal(ex.zh, draft.shared.zh);
    assert.equal(ex.source, draft.shared.source);
    assert.equal(ex.encounteredAt, draft.shared.encounteredAt);
    assert.deepEqual(ex.exampleTags, [entry.term]);
    assert.deepEqual(ex.grammarAnalysis, createGrammarAnalysis());
    assert.equal(ex.note, "");
    assert.equal(ex.contextAnalysis, "");
    assert.equal(entry.definitions.length, 2);
  }
  assert.equal(draft.entries[0].personalExamples[0].zh, "初稿");
});

test("detailed entries share grammar edits and retain word-specific context", () => {
  const draft = fixture(true);
  const entries = entriesForSave(draft);
  for (const entry of entries) {
    assert.deepEqual(entry.personalExamples[0].grammarAnalysis, draft.shared.grammarAnalysis);
    assert.equal(entry.personalExamples[0].contextAnalysis, "语境 " + entry.term);
  }
  entries[0].personalExamples[0].grammarAnalysis.parts.length = 0;
  assert.equal(entries[1].personalExamples[0].grammarAnalysis.parts.length, 1);
});

test("a malformed source or duplicate headword prevents saving the entire batch", () => {
  const draft = fixture(false);
  draft.entries[1].definitions[1].url = "javascript:alert(1)";
  assert.throws(() => entriesForSave(draft), /来源网址/);
  draft.entries[1].term = draft.entries[0].term;
  assert.throws(() => entriesForSave(draft), /重复/);
});

test("guided dictionaries lead without changing stored order or discarding homographs", () => {
  const otherSense = (role, pos, en) => ({ role, partOfSpeech: pos, definitionEn: en, definitionZh: "" });
  const guided = { definitionEn: "a turn", partOfSpeech: "noun", senseGuide: { alsoBasic: false, senses: [
    otherSense("basic", "noun", "a turn"), otherSense("common", "noun", "one"),
    otherSense("common", "noun", "two"), otherSense("common", "noun", "three"),
    otherSense("other", "verb", "a turn"),
  ] } };
  const entries = [{ dictionary: "DeepSeek（AI 生成，待核对）" }, guided, { dictionary: "旧词典" }];
  assert.deepEqual(orderedDefinitions(entries), [guided, entries[2], entries[0]]);
  assert.equal(entries[1], guided);
  const groups = groupGuideSenses(guided);
  assert.equal(groups.alsoBasic, true);
  assert.deepEqual(groups.basic, []);
  assert.deepEqual(groups.common.map(x => x.definitionEn), ["one", "two"]);
  assert.deepEqual(groups.more.map(x => x.definitionEn), ["three", "a turn"]);
});

test("confirming a corrected shared sentence keeps its dictionary guide on the same sentence", () => {
  const draft = fixture(false);
  draft.entries[0].definitions[1].senseGuide = { sentence: "Original input.", usage: "这里的用法",
    fit: "general", alsoBasic: true, senses: [] };
  const [saved] = entriesForSave(draft);
  assert.equal(saved.definitions[1].senseGuide.sentence, saved.personalExamples[0].en);
  assert.equal(saved.definitions[1].senseGuide.usage, "这里的用法");
  assert.equal(draft.entries[0].definitions[1].senseGuide.sentence, "Original input.");
});

test("partial drafts retain original identities, request order and learner edits during repair", () => {
  const { entries, shared } = fixture(false);
  const input = { terms: ["final", "absent", "sentence"], sentence: shared.en, source: shared.source, detailed: false };
  const initial = prepareDraft({ entries, missingTerms: ["absent"], warnings: [], saveTarget: "repo" }, input);
  assert.deepEqual(initial.missingTerms, ["absent"]);
  initial.entries[0].term = "edited headword";
  initial.entries[1].notes = "Keep these edits.";
  initial.shared.zh = "人工核对译文";
  assert.deepEqual(entriesForSave(initial).map(entry => entry.term), ["edited headword", "sentence"]);
  const recovered = createEntry({ ...entries[0], id: "recovered-entry", term: "absent" });
  const repaired = prepareDraft({ entries: [recovered], warnings: ["已补充"], saveTarget: "repo" },
    { ...input, terms: ["absent"] });
  const complete = mergeRepair(initial, repaired);
  assert.deepEqual(complete.successfulTerms, input.terms);
  assert.deepEqual(complete.missingTerms, []);
  assert.deepEqual(complete.entries.map(entry => entry.id), [entries[0].id, recovered.id, entries[1].id]);
  const saved = entriesForSave(complete);
  assert.deepEqual(saved.map(entry => entry.term), ["edited headword", "absent", "sentence"]);
  assert.equal(saved[2].notes, "Keep these edits.");
  assert.ok(saved.every(entry => entry.personalExamples[0].zh === "人工核对译文"));
  assert.throws(() => mergeRepair(initial, { ...repaired, saveTarget: "different-repo" }), /仓库/);
  assert.throws(() => mergeRepair(initial, { ...repaired, requestedTerms: ["final"] }), /待补录/);
});
