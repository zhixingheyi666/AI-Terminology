import { test } from "node:test";
import assert from "node:assert/strict";
import { createEntry, createEmptyData, validateData } from "../assets/model.js";
import { prepareDrafts, mergeDraftBatch } from "../assets/draft-library.js";

function word(term, sentence) {
  return createEntry({ term, notes: "新笔记", tags: ["机器学习"], reviewTags: ["搭配"],
    definitions: [{ dictionary: "DeepSeek", definitionEn: "A learning definition.", examples: [] }],
    personalExamples: [{ en: sentence, zh: "译文" }] });
}

test("a reviewed batch preserves known words and atomically adds shared encounters", () => {
  const old = word("token", "An earlier example.");
  old.notes = "自己的笔记";
  old.status = "mastered";
  old.tags = ["章节二"];
  old.personalExamples[0].contextAnalysis = "自己的详细分析";
  const library = { ...createEmptyData(), entries: [old] };
  const snapshot = structuredClone(library);
  const sentence = "Each token represents an input.";
  const drafts = prepareDrafts(library, [word("Token", sentence), word("represents", sentence)]);
  assert.equal(drafts[0].status, "mastered");
  assert.deepEqual(drafts[0].tags, ["章节二", "机器学习"]);
  assert.match(drafts[0].notes, /自己的笔记/);
  drafts[0].personalExamples[0].zh = drafts[1].personalExamples[0].zh = "用户改过的翻译";
  const {data, firstId} = mergeDraftBatch(library, drafts);
  assert.equal(validateData(data).valid, true);
  assert.equal(firstId, old.id);
  assert.equal(data.entries[0].createdAt, old.createdAt);
  assert.equal(data.entries[0].definitions.length, 1);
  assert.deepEqual(data.entries.map(e => e.personalExamples.at(-1).zh), ["用户改过的翻译", "用户改过的翻译"]);
  assert.equal(mergeDraftBatch(data, drafts).data.entries[0].personalExamples.length, 2);
  assert.deepEqual(library, snapshot);
  drafts[1].definitions = [];
  assert.throws(() => mergeDraftBatch(library, drafts));
  assert.deepEqual(library, snapshot);
});

test("adding the same sentence in ordinary mode preserves its existing detailed analysis", () => {
  const old = word("model", "The model predicts a token.");
  old.personalExamples[0].grammarAnalysis.core = "The model predicts.";
  const same = word("model", old.personalExamples[0].en);
  const library = { ...createEmptyData(), entries: [old] };
  const {data} = mergeDraftBatch(library, prepareDrafts(library, [same]));
  assert.equal(data.entries[0].personalExamples.length, 1);
  assert.equal(data.entries[0].personalExamples[0].grammarAnalysis.core, "The model predicts.");
});
