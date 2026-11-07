import { normalizeSearch, normalizeTags, nowIso, validateData } from "./model.js?v=1.4.2";

// Keep spelling variants together without guessing inflections or related words.
export function termKey(value) {
  return normalizeSearch(normalizeSearch(value).replace(/[-\u2010-\u2015\u2212]+/gu, " "));
}

export function sentenceKey(value) {
  return normalizeSearch(value).replace(/[\u2018\u2019]/gu, "'").replace(/[\u201c\u201d]/gu, '"');
}

export function hasEncounter(entry, sentence) {
  const key = sentenceKey(sentence);
  return Boolean(key && entry.personalExamples?.some(example => sentenceKey(example.en) === key));
}

export function findTermMatch(library, term) {
  const key = termKey(term);
  const candidates = key ? library.entries.filter(entry => termKey(entry.term) === key) : [];
  const exact = candidates.filter(entry => normalizeSearch(entry.term) === normalizeSearch(term));
  if (exact.length === 1) return { kind: "exact", entry: exact[0], candidates };
  if (candidates.length === 1) return { kind: "equivalent", entry: candidates[0], candidates };
  return { kind: candidates.length ? "ambiguous" : "new", entry: null, candidates };
}

function matchedEntry(library, term) {
  const match = findTermMatch(library, term);
  if (match.kind === "ambiguous") {
    throw new Error("「" + term + "」匹配到多个已有词条，请先在词库中核对，避免保存到错误的词条。");
  }
  return match.entry;
}

function selectedEntry(library, term, selectedId) {
  if (!selectedId) return matchedEntry(library, term);
  const candidates = library.entries.filter(entry => entry.id === selectedId);
  if (candidates.length !== 1) throw new Error("选定的已有词条已变化，请重新选择录入方式。");
  const collision = findTermMatch(library, term).candidates.some(entry => entry.id !== selectedId);
  if (collision) throw new Error("「" + term + "」已属于另一个词条，请先核对，避免合并错误。");
  return candidates[0];
}

function selectedIds(drafts, options) {
  const ids = options.existingEntryIds;
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.length !== drafts.length || ids.some(id => typeof id !== "string")) {
    throw new Error("已有词条的选择与草稿不一致，请重新生成。");
  }
  const nonempty = ids.filter(Boolean);
  if (new Set(nonempty).size !== nonempty.length) throw new Error("多个草稿指向同一个已有词条，请核对后再保存。");
  return ids;
}

// The editable fields on a known word start with the learner's own choices.
export function prepareDrafts(library, drafts, options = {}) {
  const ids = selectedIds(drafts, options);
  return drafts.map((draft, index) => {
    const previous = selectedEntry(library, draft.term, ids[index]);
    if (!previous) return draft;
    return {
      ...draft,
      status: previous.status,
      phonetic: draft.phonetic || previous.phonetic,
      tags: normalizeTags([...previous.tags, ...draft.tags]),
      reviewTags: normalizeTags([...(previous.reviewTags || []), ...draft.reviewTags]),
      notes: [...new Set([previous.notes, draft.notes].filter(Boolean).flatMap(note => note.split(/\n\s*\n/)))].join("\n\n"),
    };
  });
}

function definitionKey(definition) {
  if (definition.senseGuide) {
    // Each reading belongs to its sentence; a new encounter can use another sense.
    return JSON.stringify(["guide", normalizeSearch(definition.url || definition.dictionary),
      sentenceKey(definition.senseGuide.sentence)]);
  }
  return JSON.stringify([definition.dictionary, definition.url, definition.partOfSpeech, definition.definitionEn || definition.definitionZh].map(normalizeSearch));
}

function mergeDefinitions(previous, incoming) {
  const merged = new Map(previous.map((definition) => [definitionKey(definition), definition]));
  for (const definition of incoming) {
    const key = definitionKey(definition);
    let existing = merged.get(key);
    if (!existing && definition.senseGuide) {
      const oldKey = definitionKey({ ...definition, senseGuide: undefined });
      existing = merged.get(oldKey);
      if (existing) merged.delete(oldKey);
    }
    if (!existing) {
      merged.set(key, definition);
      continue;
    }
    const previousExamples = normalizeSearch(existing.definitionEn) === normalizeSearch(definition.definitionEn)
      ? existing.examples : [];
    const examples = new Map([...previousExamples, ...definition.examples].map((example) => [sentenceKey(example.en), example]));
    merged.set(key, { ...definition, id: existing.id, examples: [...examples.values()] });
  }
  return [...merged.values()];
}

function mergeEncounters(previous, incoming) {
  const result = previous.slice();
  for (const example of incoming) {
    const index = result.findIndex((old) => old.id === example.id || sentenceKey(old.en) === sentenceKey(example.en));
    if (index === -1) {
      result.push(example);
      continue;
    }
    const old = result[index];
    const grammar = example.grammarAnalysis;
    const hasAnalysis = grammar?.structure || grammar?.core || grammar?.rewrite || grammar?.parts?.length;
    const wordForms = new Map([...(old.wordForms || []), ...(example.wordForms || [])].map(form => [
      JSON.stringify([normalizeSearch(form.text), termKey(form.lemma)]), form,
    ]));
    result[index] = {
      ...old, ...example, id: old.id,
      source: example.source.trim() || old.source,
      ...(wordForms.size ? { wordForms: [...wordForms.values()] } : {}),
      encounteredAt: old.encounteredAt || example.encounteredAt,
      note: example.note || old.note,
      contextAnalysis: example.contextAnalysis || old.contextAnalysis,
      exampleTags: normalizeTags([...(old.exampleTags || []), ...(example.exampleTags || [])]),
      grammarAnalysis: hasAnalysis ? grammar : old.grammarAnalysis,
    };
  }
  return result;
}

export function mergeDraftBatch(library, drafts, updatedAt = nowIso(), options = {}) {
  if (!Array.isArray(drafts) || !drafts.length) throw new Error("请先自动填写词条。");
  const ids = selectedIds(drafts, options);
  const validation = validateData({ schemaVersion: 1, updatedAt, entries: drafts });
  if (!validation.valid) throw new Error(validation.errors[0]);
  const entries = library.entries.slice();
  const seen = new Set();
  let firstId;
  for (const [draftIndex, draft] of drafts.entries()) {
    const term = termKey(draft.term);
    if (seen.has(term)) throw new Error("草稿中有重复的词，请检查后再保存。");
    seen.add(term);
    const previous = selectedEntry({ entries }, draft.term, ids[draftIndex]);
    const index = previous ? entries.indexOf(previous) : -1;
    let entry;
    if (index < 0) {
      entry = { ...draft, createdAt: updatedAt, updatedAt };
      entries.push(entry);
    } else {
      entry = {
        ...previous, ...draft, term: ids[draftIndex] ? draft.term : previous.term,
        id: previous.id, createdAt: previous.createdAt, updatedAt,
        definitions: mergeDefinitions(previous.definitions, draft.definitions),
        personalExamples: mergeEncounters(previous.personalExamples, draft.personalExamples),
      };
      entries[index] = entry;
    }
    firstId ??= entry.id;
  }
  const data = { ...library, updatedAt, entries };
  const checked = validateData(data);
  if (!checked.valid) throw new Error(checked.errors[0]);
  return { data, firstId };
}
