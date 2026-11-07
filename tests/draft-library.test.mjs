import { test } from "node:test";
import assert from "node:assert/strict";
import { createEntry, createEmptyData, filterEntries, normalizeData, validateData } from "../assets/model.js";
import { findTermMatch, hasEncounter, prepareDrafts, mergeDraftBatch, sentenceKey, termKey } from "../assets/draft-library.js";

function word(term, sentence) {
  return createEntry({ term, notes: "新笔记", tags: ["机器学习"], reviewTags: ["搭配"],
    definitions: [{ dictionary: "DeepSeek", definitionEn: "A learning definition.", examples: [] }],
    personalExamples: [{ en: sentence, zh: "译文" }] });
}

test("ranked dictionary readings survive export, reload, enrichment and a different sentence", () => {
  const firstSentence = "The model is trained on a corpus.";
  const existing = word("model", firstSentence);
  const dictionary = { dictionary: "Open English WordNet", url: "https://en-word.net/view/lemma/model",
    partOfSpeech: "noun", definitionEn: "A representation.", definitionZh: "表示", examples: [] };
  existing.definitions = [createEntry({definitions: [dictionary]}).definitions[0]];
  const oldDefinitionId = existing.definitions[0].id;
  function reading(sentence, primary) {
    const draft = word("model", sentence);
    draft.definitions = createEntry({definitions: [{ ...dictionary, definitionEn: primary,
      senseGuide: { sentence, usage: "解释词在原句中的意思", fit: "contextual", alsoBasic: false,
        senses: [
          { role: "basic", partOfSpeech: "noun", definitionEn: "A physical representation.", definitionZh: "缩小的模型" },
          { role: "other", partOfSpeech: "noun", definitionEn: "An exemplar.", definitionZh: "典范" },
        ] } }]}).definitions;
    return draft;
  }
  let data = { ...createEmptyData(), entries: [existing] };
  data = mergeDraftBatch(data, [reading(firstSentence, dictionary.definitionEn)]).data;
  assert.equal(data.entries[0].definitions.length, 1);
  assert.equal(data.entries[0].definitions[0].id, oldDefinitionId);
  data = mergeDraftBatch(data, [reading("She built a model.", "A scale copy.")]).data;
  data = mergeDraftBatch(data, [reading(firstSentence, "A statistical representation.")]).data;
  assert.equal(data.entries[0].definitions.length, 2);
  const restored = normalizeData(JSON.parse(JSON.stringify(data)));
  assert.deepEqual(restored, data);
  assert.equal(filterEntries(restored.entries, {query: "典范"}).length, 1);
  const guide = restored.entries[0].definitions[0].senseGuide;
  guide.alsoBasic = true;
  assert.equal(validateData(restored).valid, false);
});

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

test("known terms match spelling variants without stemming unrelated inflections", () => {
  const known = word("machine learning", "Our example.");
  const library = { ...createEmptyData(), entries: [known] };
  for (const spelling of ["MACHINE-LEARNING", "machine\u2011learning", "machine  learning", "ＭＡＣＨＩＮＥ learning"]) {
    assert.equal(termKey(spelling), "machine learning");
    const found = findTermMatch(library, spelling);
    assert.equal(found.entry.id, known.id);
    assert.deepEqual(found.candidates, [known]);
  }
  assert.equal(findTermMatch(library, "Machine Learning").kind, "exact");
  assert.equal(findTermMatch(library, "machine-learning").kind, "equivalent");
  assert.equal(findTermMatch({ entries: [word("speak", "Our example.")] }, "speaks").kind, "new");
  assert.deepEqual(findTermMatch(library, ""), { kind: "new", entry: null, candidates: [] });
});

test("a canonical match preserves response identity during preparation and stored identity during save", () => {
  const old = word("machine learning", "An older sentence.");
  old.status = "mastered";
  const library = { ...createEmptyData(), entries: [old] };
  const [draft] = prepareDrafts(library, [word("MACHINE-LEARNING", "A new sentence.")]);
  assert.equal(draft.term, "MACHINE-LEARNING");
  assert.equal(draft.status, "mastered");
  const { data, firstId } = mergeDraftBatch(library, [draft]);
  assert.equal(data.entries.length, 1);
  assert.equal(data.entries[0].term, old.term);
  assert.equal(data.entries[0].id, old.id);
  assert.equal(data.entries[0].createdAt, old.createdAt);
  assert.equal(data.entries[0].personalExamples.length, 2);
  assert.equal(firstId, old.id);
});

test("ambiguous aliases never choose a word arbitrarily, while a unique exact spelling is usable", () => {
  const spaced = word("machine learning", "Our example.");
  const hyphenated = word("machine-learning", "Another example.");
  const library = { ...createEmptyData(), entries: [spaced, hyphenated] };
  const match = findTermMatch(library, "machine\u2011learning");
  assert.equal(match.kind, "ambiguous");
  assert.equal(match.entry, null);
  assert.deepEqual(match.candidates, [spaced, hyphenated]);
  assert.equal(findTermMatch(library, "MACHINE-LEARNING").entry, hyphenated);
  assert.equal(findTermMatch(library, "machine learning").entry, spaced);
  const snapshot = structuredClone(library);
  const draft = word("machine\u2011learning", "The latest example.");
  assert.throws(() => prepareDrafts(library, [draft]), /多个已有词条/);
  assert.throws(() => mergeDraftBatch(library, [word("token", "New sentence."), draft]), /多个已有词条/);
  assert.deepEqual(library, snapshot);
});

test("equivalent targets cannot produce duplicate entries in a batch", () => {
  const library = createEmptyData();
  const snapshot = structuredClone(library);
  assert.throws(() => mergeDraftBatch(library, [
    word("machine-learning", "Shared sentence."), word("MACHINE LEARNING", "Shared sentence."),
  ]), /重复/);
  assert.deepEqual(library, snapshot);
});

test("same sentence is recognized across formatting and sources while punctuation keeps distinct meanings", () => {
  const old = word("speak", "That’s \u201cmodel speak\u201d for prediction.");
  old.personalExamples[0].source = "Chapter 1";
  old.personalExamples[0].encounteredAt = "2026-10-30";
  old.personalExamples[0].grammarAnalysis.core = "Own analysis.";
  const library = { ...createEmptyData(), entries: [old] };
  const equivalent = "THAT'S  \"model speak\"\nfor prediction.";
  assert.equal(sentenceKey(equivalent), sentenceKey(old.personalExamples[0].en));
  assert.equal(hasEncounter(old, equivalent), true);
  assert.equal(hasEncounter(old, ""), false);
  const update = word("SPEAK", equivalent);
  update.personalExamples[0].source = "";
  let merged = mergeDraftBatch(library, [update]).data;
  assert.equal(merged.entries[0].personalExamples.length, 1);
  let encounter = merged.entries[0].personalExamples[0];
  assert.equal(encounter.id, old.personalExamples[0].id);
  assert.equal(encounter.source, "Chapter 1");
  assert.equal(encounter.encounteredAt, "2026-10-30");
  assert.equal(encounter.grammarAnalysis.core, "Own analysis.");
  update.personalExamples[0].source = "Chapter 2";
  merged = mergeDraftBatch(merged, [update]).data;
  assert.equal(merged.entries[0].personalExamples.length, 1);
  assert.equal(merged.entries[0].personalExamples[0].source, "Chapter 2");
  const question = word("speak", "That's \"model speak\" for prediction?");
  assert.equal(hasEncounter(merged.entries[0], question.personalExamples[0].en), false);
  merged = mergeDraftBatch(merged, [question]).data;
  assert.equal(merged.entries[0].personalExamples.length, 2);
});

test("formatted repeats reuse their dictionary reading as well as their sentence", () => {
  const old = word("model", "It’s a model.");
  old.definitions[0].senseGuide = { sentence: old.personalExamples[0].en, usage: "Old usage", fit: "general", alsoBasic: true, senses: [] };
  const update = word("model", "IT'S  a model.");
  update.definitions[0].senseGuide = { ...old.definitions[0].senseGuide, sentence: update.personalExamples[0].en, usage: "Revised usage" };
  const { data } = mergeDraftBatch({ ...createEmptyData(), entries: [old] }, [update]);
  assert.equal(data.entries[0].definitions.length, 1);
  assert.equal(data.entries[0].definitions[0].id, old.definitions[0].id);
  assert.equal(data.entries[0].definitions[0].senseGuide.usage, "Revised usage");
  assert.equal(data.entries[0].personalExamples.length, 1);
});

test("same-sentence updates retain all original word forms and keep old entries without metadata unchanged", () => {
  const old = word("model", "The model models other models.");
  old.personalExamples[0].wordForms = [{ text: "models", lemma: "model", label: "名词复数" }];
  const update = word("model", old.personalExamples[0].en);
  update.personalExamples[0].wordForms = [
    { text: "MODELS", lemma: "model", label: "名词复数 / 动词第三人称单数" },
    { text: "model", lemma: "model", label: "原形" },
  ];
  const original = structuredClone(old);
  let data = mergeDraftBatch({ ...createEmptyData(), entries: [old] }, [update]).data;
  assert.deepEqual(data.entries[0].personalExamples[0].wordForms, update.personalExamples[0].wordForms);
  const plain = word("model", old.personalExamples[0].en);
  data = mergeDraftBatch(data, [plain]).data;
  assert.equal(data.entries[0].personalExamples[0].wordForms.length, 2);
  assert.deepEqual(old, original);
  const unannotated = word("speak", "The teachers speak.");
  const unchanged = mergeDraftBatch({ ...createEmptyData(), entries: [unannotated] }, [word("speak", unannotated.personalExamples[0].en)]).data;
  assert.equal(Object.hasOwn(unchanged.entries[0].personalExamples[0], "wordForms"), false);
});

test("explicit existing IDs reject stale selections, duplicate targets and headword collisions atomically", () => {
  const plural = word("statisticians", "An old sentence.");
  const base = word("statistician", "A different old sentence.");
  const library = { ...createEmptyData(), entries: [plural, base] };
  const snapshot = structuredClone(library);
  const incoming = word("statistician", "A new sentence.");
  assert.throws(() => prepareDrafts(library, [incoming], { existingEntryIds: ["missing-id"] }), /已变化/);
  assert.throws(() => mergeDraftBatch(library, [incoming], undefined, { existingEntryIds: ["missing-id"] }), /已变化/);
  assert.throws(() => prepareDrafts(library, [incoming], { existingEntryIds: [plural.id] }), /另一个词条/);
  assert.throws(() => mergeDraftBatch(library, [word("new", "New example."), incoming], undefined,
    { existingEntryIds: ["", plural.id] }), /另一个词条/);
  assert.throws(() => mergeDraftBatch(library, [incoming], undefined, { existingEntryIds: [] }), /不一致/);
  assert.throws(() => mergeDraftBatch(library, [incoming, word("other", "Other sentence.")], undefined,
    { existingEntryIds: [base.id, base.id] }), /同一个已有词条/);
  assert.deepEqual(library, snapshot);
});
