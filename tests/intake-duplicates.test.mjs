import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createEmptyData, createEntry } from "../assets/model.js";
import { mergeDraftBatch, prepareDrafts, termKey } from "../assets/draft-library.js";
import { assertIntakeTargets, buildIntakePlan, chooseWordForm, entriesForSave, mergeRepair,
  parseTargetTerms, prepareDraft } from "../assets/intake-ui.js";
import { createWordFormIndex, findWordFormMatch, resolveWordForms } from "../assets/word-forms.js";

const sentence = "The model predicts the next token.";

function word(term, id, en = "An earlier sentence.", source = "Earlier chapter") {
  return createEntry({ id, term,
    definitions: [{ dictionary: "Test dictionary", definitionEn: "A test meaning." }],
    personalExamples: [{ en, zh: "已有译文", source }],
  });
}

function library(...entries) {
  return { ...createEmptyData(), entries };
}

test("existing terms are skipped before generation while new terms remain selected", () => {
  const known = word("token", "known-token");
  const plan = buildIntakePlan({ terms: ["Token", "predicts"], sentence, library: library(known) });
  assert.deepEqual(plan.items.map(item => item.action), ["skip", "new"]);
  assert.equal(plan.items[0].match.entry.id, known.id);
  assert.deepEqual(plan.terms, ["predicts"]);
  assert.deepEqual(plan.existingEntryIds, [""]);
});

test("an explicit choice updates only its matching existing entry in input order", () => {
  const token = word("token", "known-token");
  const model = word("model", "known-model");
  const choices = new Map([[termKey("TOKEN"), token.id]]);
  const plan = buildIntakePlan({ terms: ["predicts", "TOKEN", "model", "next"], sentence,
    library: library(model, token), choices });
  assert.deepEqual(plan.items.map(item => item.action), ["new", "update", "skip", "new"]);
  assert.deepEqual(plan.terms, ["predicts", "TOKEN", "next"]);
  assert.deepEqual(plan.existingEntryIds, ["", token.id, ""]);
});

test("case, whitespace and hyphen variants identify an existing word without stemming", () => {
  const known = word("machine learning", "known-machine-learning");
  const data = library(known, word("speak", "known-speak"));
  const terms = parseTargetTerms('MACHINE-LEARNING “machine   learning” machine‐learning speaks');
  assert.deepEqual(terms, ["MACHINE-LEARNING", "speaks"]);
  const choices = new Map([[termKey("machine‐learning"), known.id]]);
  const plan = buildIntakePlan({ terms, sentence, library: data, choices });
  assert.equal(plan.items[0].match.kind, "equivalent");
  assert.deepEqual(plan.items.map(item => item.action), ["update", "new"]);
  assert.deepEqual(plan.terms, terms);
  assert.deepEqual(plan.existingEntryIds, [known.id, ""]);
});

test("a stale choice cannot grant permission to update a replacement entry", () => {
  const known = word("token", "replacement-token");
  const choices = new Map([[termKey("token"), "old-token-id"]]);
  const plan = buildIntakePlan({ terms: ["token"], sentence, library: library(known), choices });
  assert.equal(plan.items[0].action, "skip");
  assert.deepEqual(plan.terms, []);
  assert.deepEqual(plan.existingEntryIds, []);
});

test("a repeated sentence is recognized independently of its saved source and typography", () => {
  const known = word("token", "known-token", "That’s  a token.", "First book, chapter 2");
  const plan = buildIntakePlan({ terms: ["token"], sentence: "  That's a token.  ",
    source: "Second source", library: library(known) });
  assert.equal(plan.items[0].sameSentence, true);
  assert.equal(plan.items[0].action, "skip");
  const update = buildIntakePlan({ terms: ["token"], sentence: "That's a token.",
    library: library(known), choices: new Map([[termKey("token"), known.id]]) });
  assert.equal(update.items[0].sameSentence, true);
  assert.equal(update.items[0].action, "update");
  assert.deepEqual(update.existingEntryIds, [known.id]);
  const different = buildIntakePlan({ terms: ["token"], sentence: "That isn't a token.", library: library(known) });
  assert.equal(different.items[0].sameSentence, false);
});

test("ambiguous spelling variants stay blocked even if one candidate was selected earlier", () => {
  const hyphenated = word("machine-learning", "hyphenated-entry");
  const spaced = word("machine learning", "spaced-entry");
  const data = library(hyphenated, spaced);
  const choices = new Map([[termKey("machine‐learning"), hyphenated.id]]);
  const plan = buildIntakePlan({ terms: ["machine‐learning", "token"], sentence, library: data, choices });
  assert.equal(plan.items[0].match.kind, "ambiguous");
  assert.equal(plan.items[0].match.candidates.length, 2);
  assert.equal(plan.items[0].action, "blocked");
  assert.deepEqual(plan.terms, ["token"]);
  assert.deepEqual(plan.existingEntryIds, [""]);
  const exact = buildIntakePlan({ terms: ["machine-learning"], sentence, library: data, choices });
  assert.equal(exact.items[0].action, "update");
  assert.deepEqual(exact.existingEntryIds, [hyphenated.id]);
});

test("all existing terms default to an empty request without changing the library or choices", () => {
  const data = library(word("model", "known-model"), word("token", "known-token"));
  const before = structuredClone(data);
  const terms = ["model", "TOKEN"];
  const choices = new Map();
  const plan = buildIntakePlan({ terms, sentence, library: data, choices });
  assert.deepEqual(plan.items.map(item => item.action), ["skip", "skip"]);
  assert.deepEqual(plan.terms, []);
  assert.deepEqual(plan.existingEntryIds, []);
  assert.deepEqual(data, before);
  assert.deepEqual(terms, ["model", "TOKEN"]);
  assert.equal(choices.size, 0);
});

test("choice IDs never attach a new term or a different existing term to the wrong entry", () => {
  const token = word("token", "known-token");
  const model = word("model", "known-model");
  const choices = new Map([[termKey("newcomer"), token.id], [termKey("model"), token.id],
    [termKey("token"), token.id]]);
  const plan = buildIntakePlan({ terms: ["newcomer", "model", "token"], sentence,
    library: library(token, model), choices });
  assert.deepEqual(plan.items.map(item => item.action), ["new", "skip", "update"]);
  assert.deepEqual(plan.terms, ["newcomer", "token"]);
  assert.deepEqual(plan.existingEntryIds, ["", token.id]);
});

test("the save guard accepts the selected known entry and truly new terms", () => {
  const known = word("machine learning", "known-machine-learning");
  assert.doesNotThrow(() => assertIntakeTargets(library(known),
    ["machine-learning", "token"], [known.id, ""]));
});

test("the save guard blocks incomplete or reordered target identity metadata", () => {
  const model = word("model", "known-model");
  const token = word("token", "known-token");
  const data = library(model, token);
  assert.throws(() => assertIntakeTargets(data, ["model"], undefined), /选择/);
  assert.throws(() => assertIntakeTargets(data, ["model", "token"], [model.id]), /选择/);
  assert.throws(() => assertIntakeTargets(data, ["model", "token"], [token.id, model.id]), /变化/);
});

test("the save guard rechecks additions, deletions and replacement entries", () => {
  const token = word("token", "known-token");
  assert.throws(() => assertIntakeTargets(library(token), ["token"], [""]), /变化/);
  assert.throws(() => assertIntakeTargets(library(), ["token"], [token.id]), /变化/);
  assert.throws(() => assertIntakeTargets(library(word("token", "replacement-token")),
    ["token"], [token.id]), /变化/);
});

test("the save guard refuses a newly ambiguous alias even when an older choice matches a candidate", () => {
  const known = word("machine learning", "known-machine-learning");
  const other = word("machine-learning", "new-hyphenated-entry");
  assert.doesNotThrow(() => assertIntakeTargets(library(known), ["machine‐learning"], [known.id]));
  assert.throws(() => assertIntakeTargets(library(known, other), ["machine‐learning"], [known.id]), /变化/);
});

function candidate(lemma, form, label) {
  return { lemma, form, label };
}

test("one distinct verified lemma is selected automatically and retains all applicable labels", () => {
  const candidates = [candidate("model", "plural", "名词复数"),
    candidate("model", "third-person", "动词第三人称单数"), candidate("model", "plural", "名词复数")];
  assert.deepEqual(chooseWordForm("Models", candidates), {
    text: "Models", lemma: "model", label: "名词复数 / 动词第三人称单数",
  });
  assert.equal(chooseWordForm("model", [candidate("model", "base", "独立词条")]), null);
  assert.equal(chooseWordForm("unknownword", []), null);
});

test("ambiguous forms retain the submitted spelling until the learner chooses", () => {
  assert.equal(chooseWordForm("running", [candidate("running", "base", "独立词条"),
    candidate("run", "ing", "现在分词")]), null);
  assert.equal(chooseWordForm("saw", [candidate("saw", "base", "独立词条"),
    candidate("see", "past", "过去式")]), null);
  assert.equal(chooseWordForm("routed", [candidate("route", "past-or-participle", "过去式 / 过去分词"),
    candidate("rout", "past-or-participle", "过去式 / 过去分词")]), null);
});

test("manual lemma selection accepts only a verified alternative and can keep the surface form", () => {
  const candidates = [candidate("saw", "base", "独立词条"), candidate("see", "past", "过去式")];
  assert.deepEqual(chooseWordForm("saw", candidates, "see"), { text: "saw", lemma: "see", label: "过去式" });
  assert.equal(chooseWordForm("saw", candidates, "saw"), null);
  assert.equal(chooseWordForm("saw", candidates, "look"), null);
});

test("a base word and its plural produce one request while preserving the original-form label", () => {
  const forms = new Map([[termKey("models"), { text: "models", lemma: "model", label: "名词复数" }]]);
  const plan = buildIntakePlan({ terms: ["model", "models"], sentence, library: library(), forms });
  assert.deepEqual(plan.terms, ["model"]);
  assert.deepEqual(plan.existingEntryIds, [""]);
  assert.deepEqual(plan.items.map(item => item.lookupTerm), ["model", "model"]);
  assert.deepEqual(plan.wordFormsByTerm.model, [{ text: "models", lemma: "model", label: "名词复数" }]);
  assert.equal(forms.size, 1);
  const reversed = buildIntakePlan({ terms: ["models", "model"], sentence, library: library(), forms });
  assert.deepEqual(reversed.terms, ["model"]);
  assert.deepEqual(reversed.wordFormsByTerm.model, plan.wordFormsByTerm.model);
});

test("two inflected forms merge into one request without losing either original label", () => {
  const forms = new Map([
    [termKey("runs"), { text: "runs", lemma: "run", label: "动词第三人称单数" }],
    [termKey("running"), { text: "running", lemma: "run", label: "现在分词" }],
  ]);
  const plan = buildIntakePlan({ terms: ["token", "runs", "next", "running"], sentence, library: library(), forms });
  assert.deepEqual(plan.terms, ["token", "run", "next"]);
  assert.deepEqual(plan.existingEntryIds, ["", "", ""]);
  assert.deepEqual(plan.wordFormsByTerm.run, [...forms.values()]);
});

test("an inflected term detects its existing base entry and requires that base entry's update choice", () => {
  const known = word("model", "known-model", sentence);
  const forms = new Map([[termKey("models"), { text: "models", lemma: "model", label: "名词复数" }]]);
  const input = { terms: ["models"], sentence, library: library(known), forms };
  const skipped = buildIntakePlan(input);
  assert.equal(skipped.items[0].term, "models");
  assert.equal(skipped.items[0].lookupTerm, "model");
  assert.equal(skipped.items[0].sameSentence, true);
  assert.equal(skipped.items[0].action, "skip");
  assert.deepEqual(skipped.terms, []);
  const selected = buildIntakePlan({ ...input, choices: new Map([[termKey("model"), known.id]]) });
  assert.equal(selected.items[0].action, "update");
  assert.deepEqual(selected.terms, ["model"]);
  assert.deepEqual(selected.existingEntryIds, [known.id]);
  const wrongKey = buildIntakePlan({ ...input, choices: new Map([[termKey("models"), known.id]]) });
  assert.equal(wrongKey.items[0].action, "skip");
});

test("a real verified plural updates its legacy entry through review and save without creating a duplicate", async () => {
  const wordFormIndex = createWordFormIndex(JSON.parse(await readFile(
    new URL("../data/word-forms-2025.json", import.meta.url), "utf8")));
  const en = "The statisticians compare two estimates.";
  const old = word("statisticians", "legacy-statisticians", en);
  old.createdAt = "2026-10-31T01:00:00.000Z";
  old.updatedAt = old.createdAt;
  old.status = "mastered";
  old.notes = "保留手写笔记";
  old.personalExamples[0].encounteredAt = "2026-10-31";
  const data = library(old);
  const snapshot = structuredClone(data);
  const form = chooseWordForm("statisticians", resolveWordForms("statisticians", wordFormIndex));
  assert.deepEqual(form, { text: "statisticians", lemma: "statistician", label: "名词复数" });
  const match = findWordFormMatch(data, form.lemma, wordFormIndex);
  assert.equal(match.kind, "inflected");
  assert.equal(match.entry.id, old.id);
  const input = { terms: ["statisticians"], sentence: en, library: data, wordFormIndex,
    forms: new Map([[termKey("statisticians"), form]]) };
  const skipped = buildIntakePlan(input);
  assert.equal(skipped.items[0].action, "skip");
  assert.equal(skipped.items[0].sameSentence, true);
  assert.deepEqual(skipped.terms, []);
  const selected = buildIntakePlan({ ...input, choices: new Map([[termKey("statistician"), old.id]]) });
  assert.deepEqual(selected.terms, ["statistician"]);
  assert.deepEqual(selected.existingEntryIds, [old.id]);
  assert.doesNotThrow(() => assertIntakeTargets(data, selected.terms, selected.existingEntryIds, wordFormIndex));

  const request = { ...selected, sentence: en, source: "A new chapter", detailed: false };
  const entries = prepareDrafts(data, [word("statistician", "generated-statistician", en)],
    { existingEntryIds: selected.existingEntryIds });
  const draft = prepareDraft({ entries, warnings: [], saveTarget: "test-repository" }, request);
  assert.equal(draft.entries[0].term, "statistician");
  assert.equal(draft.entries[0].status, "mastered");
  assert.match(draft.entries[0].notes, /保留手写笔记/);
  assert.deepEqual(draft.entries[0].personalExamples[0].wordForms, [form]);
  draft.shared.zh = "统计学家们比较两个估计值。";
  const saved = entriesForSave(draft);
  assert.doesNotThrow(() => assertIntakeTargets(data, saved.map(entry => entry.term),
    draft.existingEntryIds, wordFormIndex));
  const timestamp = "2026-11-07T06:00:00.000Z";
  const merged = mergeDraftBatch(data, saved, timestamp, { existingEntryIds: draft.existingEntryIds });
  assert.equal(merged.data.entries.length, 1);
  assert.equal(merged.firstId, old.id);
  const entry = merged.data.entries[0];
  assert.equal(entry.id, old.id);
  assert.equal(entry.term, "statistician");
  assert.equal(entry.createdAt, old.createdAt);
  assert.equal(entry.updatedAt, timestamp);
  assert.equal(entry.personalExamples.length, 1);
  assert.equal(entry.personalExamples[0].id, old.personalExamples[0].id);
  assert.equal(entry.personalExamples[0].encounteredAt, "2026-10-31");
  assert.equal(entry.personalExamples[0].zh, draft.shared.zh);
  assert.deepEqual(entry.personalExamples[0].wordForms, [form]);
  assert.deepEqual(data, snapshot);
});

test("partial recovery keeps existing IDs and original-form labels aligned with their requested base words", () => {
  const en = "The statisticians compare models and tokens.";
  const wordFormsByTerm = {
    token: [{ text: "tokens", lemma: "token", label: "名词复数" }],
    statistician: [{ text: "statisticians", lemma: "statistician", label: "名词复数" }],
    model: [{ text: "models", lemma: "model", label: "名词复数" }],
  };
  const request = { terms: ["token", "statistician", "model"], sentence: en, source: "Study note", detailed: false,
    existingEntryIds: ["known-token", "legacy-statisticians", ""], wordFormsByTerm };
  const initial = prepareDraft({ entries: [word("token", "generated-token", en), word("model", "generated-model", en)],
    missingTerms: ["statistician"], warnings: [], saveTarget: "same-repository" }, request);
  assert.deepEqual(initial.existingEntryIds, ["known-token", ""]);
  initial.entries[0].personalExamples[0].wordForms[0].label = "已核对：名词复数";
  initial.shared.zh = "用户核对后的译文。";
  const repaired = prepareDraft({ entries: [word("statistician", "repaired-statistician", en)],
    warnings: [], saveTarget: "same-repository" }, { ...request, terms: ["statistician"],
    existingEntryIds: ["legacy-statisticians"], wordFormsByTerm: { statistician: wordFormsByTerm.statistician } });
  const complete = mergeRepair(initial, repaired);
  assert.deepEqual(complete.successfulTerms, request.terms);
  assert.deepEqual(complete.existingEntryIds, request.existingEntryIds);
  assert.deepEqual(complete.missingTerms, []);
  const entries = entriesForSave(complete);
  assert.deepEqual(entries.map(entry => entry.term), request.terms);
  assert.deepEqual(entries.map(entry => entry.personalExamples[0].wordForms[0].text),
    ["tokens", "statisticians", "models"]);
  assert.equal(entries[0].personalExamples[0].wordForms[0].label, "已核对：名词复数");
  assert.ok(entries.every(entry => entry.personalExamples[0].zh === "用户核对后的译文。"));
  assert.deepEqual(complete.requestedWordForms, wordFormsByTerm);
});
