import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createWordFormIndex, findWordFormMatch, resolveWordForms } from "../assets/word-forms.js";
import { createEmptyData, createEntry } from "../assets/model.js";
import { mergeDraftBatch, prepareDrafts } from "../assets/draft-library.js";

const data = JSON.parse(await readFile(new URL("../data/word-forms-2025.json", import.meta.url), "utf8"));
const index = createWordFormIndex(data);
const forms = value => resolveWordForms(value, index);
const has = (value, lemma, partOfSpeech, form) => forms(value).some(candidate =>
  candidate.lemma === lemma && candidate.partOfSpeech === partOfSpeech && candidate.form === form);

test("browser morphology offers checked plural, tense and -ing candidates with explicit labels", () => {
  assert.ok(has("models", "model", "noun", "plural"));
  assert.ok(has("MODELS", "model", "verb", "third-person"));
  assert.ok(has("speaks", "speak", "verb", "third-person"));
  assert.ok(has("studied", "study", "verb", "past-or-participle"));
  assert.ok(has("running", "run", "verb", "ing"));
  assert.ok(has("went", "go", "verb", "past"));
  assert.ok(has("written", "write", "verb", "participle"));
  assert.ok(has("children", "child", "noun", "plural"));
  assert.ok(has("neural networks", "neural network", "noun", "plural"));
  for (const candidate of forms("models")) {
    assert.ok(candidate.label);
    assert.equal(candidate.evidence, "lemma-rule");
    assert.equal(candidate.sourceUrl, "https://en-word.net/view/lemma/model");
  }
  assert.equal(forms("went")[0].evidence, "exception");
});

test("distinct exact senses remain alongside inflections so callers can avoid unsafe merging", () => {
  assert.ok(has("learning", "learning", "noun", "base"));
  assert.ok(has("learning", "learn", "verb", "ing"));
  assert.ok(has("saw", "saw", "noun", "base"));
  assert.ok(has("saw", "saw", "verb", "base"));
  assert.ok(has("saw", "see", "verb", "past"));
  assert.ok(has("running", "running", "noun", "base"));
  assert.ok(has("running", "run", "verb", "ing"));
  assert.ok(has("data", "data", "noun", "base"));
  assert.ok(has("data", "datum", "noun", "plural"));
  assert.ok(has("found", "found", "verb", "base"));
  assert.ok(has("found", "find", "verb", "past-or-participle"));
});

test("rules require both real lemma/POS evidence and a plausible forward spelling", () => {
  assert.deepEqual(forms("unbelievablyfakezing"), []);
  assert.deepEqual(forms("x".repeat(121)), []);
  assert.deepEqual(forms(""), []);
  assert.ok(has("rates", "rate", "verb", "third-person"));
  assert.ok(!forms("rates").some(candidate => candidate.lemma === "rat"));
  assert.ok(has("rating", "rate", "verb", "ing"));
  assert.ok(!forms("rating").some(candidate => candidate.lemma === "rat"));
  assert.ok(has("rated", "rate", "verb", "past-or-participle"));
  assert.ok(!forms("rated").some(candidate => candidate.lemma === "rat"));
  assert.ok(has("ratting", "rat", "verb", "ing"));
  assert.ok(has("stopping", "stop", "verb", "ing"));
});

test("the compact source stays below 2 MB and ships unmodified source licenses", async () => {
  const bytes = await readFile(new URL("../data/word-forms-2025.json", import.meta.url));
  assert.ok(bytes.length < 2_000_000);
  assert.equal(data.edition, "Open English WordNet 2025");
  assert.equal(data.sourceSha256, "38b16326159f51853626b7d24a44c453fa88ab33f06fce5ec8fc5996d1c2be93");
  assert.match(data.attribution, /Princeton WordNet/);
  assert.equal(data.licenses.length, 2);
  for (const license of data.licenses) {
    const text = await readFile(new URL("../data/" + license.file, import.meta.url));
    assert.equal(createHash("sha256").update(text).digest("hex"), license.sha256);
  }
});

test("bad index shapes fail instead of guessing entries", () => {
  assert.throws(() => createWordFormIndex({}), /版本/);
  assert.throws(() => createWordFormIndex({ ...data, lemmas: {} }), /不完整/);
  assert.throws(() => createWordFormIndex({ ...data, exceptions: { ...data.exceptions, n: { bad: [42] } } }), /不完整/);
});

function word(term, sentence = "An example sentence.") {
  return createEntry({ term, status: "mastered", tags: ["原有标签"], notes: "原有笔记",
    definitions: [{ dictionary: "OEWN", definitionEn: "A source meaning.", examples: [] }],
    personalExamples: [{ en: sentence, zh: "示例译文" }] });
}

test("a legacy inflected headword is offered for its unambiguous lemma and normalized only by explicit selection", () => {
  const previous = word("statisticians");
  const library = { ...createEmptyData(), entries: [previous] };
  const match = findWordFormMatch(library, "statistician", index);
  assert.equal(match.kind, "inflected");
  assert.equal(match.entry, previous);
  const incoming = word("statistician", "A second sentence.");
  incoming.status = "learning";
  incoming.tags = ["新标签"];
  incoming.notes = "新的笔记";
  const options = { existingEntryIds: [match.entry.id] };
  const prepared = prepareDrafts(library, [incoming], options);
  assert.equal(prepared[0].term, "statistician");
  assert.equal(prepared[0].status, "mastered");
  assert.deepEqual(prepared[0].tags, ["原有标签", "新标签"]);
  const saved = mergeDraftBatch(library, prepared, undefined, options);
  assert.equal(saved.data.entries.length, 1);
  assert.equal(saved.firstId, previous.id);
  assert.equal(saved.data.entries[0].term, "statistician");
  assert.equal(saved.data.entries[0].id, previous.id);
  assert.equal(saved.data.entries[0].createdAt, previous.createdAt);
  assert.equal(saved.data.entries[0].personalExamples.length, 2);
  assert.match(saved.data.entries[0].notes, /原有笔记/);
  assert.equal(library.entries[0].term, "statisticians");
  // Morphology never changes normal library merges without the UI's choice.
  assert.equal(mergeDraftBatch(library, [incoming]).data.entries.length, 2);
  const oldModels = word("models");
  const modelLibrary = { ...createEmptyData(), entries: [oldModels] };
  assert.equal(findWordFormMatch(modelLibrary, "model", index).entry, oldModels);
  const result = mergeDraftBatch(modelLibrary, [word("model")], undefined, { existingEntryIds: [oldModels.id] });
  assert.equal(result.data.entries.length, 1);
  assert.equal(result.data.entries[0].id, oldModels.id);
  assert.equal(result.data.entries[0].term, "model");
});

test("legacy matching prefers exact base entries and refuses distinct meanings or competing aliases", () => {
  const base = word("statistician");
  const plural = word("statisticians");
  assert.equal(findWordFormMatch({ entries: [plural, base] }, "statistician", index).entry, base);
  assert.equal(findWordFormMatch({ entries: [plural] }, "STATISTICIANS", index).kind, "exact");
  assert.equal(findWordFormMatch({ entries: [word("learning")] }, "learn", index).kind, "new");
  assert.equal(findWordFormMatch({ entries: [word("saw")] }, "see", index).kind, "new");
  const match = findWordFormMatch({ entries: [word("statisticians"), word("STATISTICIANS")] }, "statistician", index);
  assert.equal(match.kind, "ambiguous");
  assert.equal(match.entry, null);
  assert.equal(match.candidates.length, 2);
  assert.equal(findWordFormMatch({ entries: [plural] }, "statistician", null).kind, "new");
});
