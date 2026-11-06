import { normalizeSearch, normalizeTags, nowIso, validateData } from "./model.js";

// The editable fields on a known word start with the learner's own choices.
export function prepareDrafts(library, drafts) {
  return drafts.map((draft) => {
    const previous = library.entries.find((entry) => normalizeSearch(entry.term) === normalizeSearch(draft.term));
    if (!previous) return draft;
    return {
      ...draft,
      term: previous.term,
      status: previous.status,
      phonetic: draft.phonetic || previous.phonetic,
      tags: normalizeTags([...previous.tags, ...draft.tags]),
      reviewTags: normalizeTags([...(previous.reviewTags || []), ...draft.reviewTags]),
      notes: [...new Set([previous.notes, draft.notes].filter(Boolean).flatMap(note => note.split(/\n\s*\n/)))].join("\n\n"),
    };
  });
}

function definitionKey(definition) {
  return JSON.stringify([definition.dictionary, definition.url, definition.partOfSpeech, definition.definitionEn || definition.definitionZh].map(normalizeSearch));
}

function mergeDefinitions(previous, incoming) {
  const merged = new Map(previous.map((definition) => [definitionKey(definition), definition]));
  for (const definition of incoming) {
    const key = definitionKey(definition);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, definition);
      continue;
    }
    const examples = new Map([...existing.examples, ...definition.examples].map((example) => [normalizeSearch(example.en), example]));
    merged.set(key, { ...definition, id: existing.id, examples: [...examples.values()] });
  }
  return [...merged.values()];
}

function mergeEncounters(previous, incoming) {
  const result = previous.slice();
  for (const example of incoming) {
    const index = result.findIndex((old) => old.id === example.id || (
      old.en.trim() === example.en.trim() && normalizeSearch(old.source) === normalizeSearch(example.source)
    ));
    if (index === -1) {
      result.push(example);
      continue;
    }
    const old = result[index];
    const grammar = example.grammarAnalysis;
    const hasAnalysis = grammar?.structure || grammar?.core || grammar?.rewrite || grammar?.parts?.length;
    result[index] = {
      ...old, ...example, id: old.id,
      encounteredAt: old.encounteredAt || example.encounteredAt,
      note: example.note || old.note,
      contextAnalysis: example.contextAnalysis || old.contextAnalysis,
      exampleTags: normalizeTags([...(old.exampleTags || []), ...(example.exampleTags || [])]),
      grammarAnalysis: hasAnalysis ? grammar : old.grammarAnalysis,
    };
  }
  return result;
}

export function mergeDraftBatch(library, drafts, updatedAt = nowIso()) {
  if (!Array.isArray(drafts) || !drafts.length) throw new Error("请先自动填写词条。");
  const validation = validateData({ schemaVersion: 1, updatedAt, entries: drafts });
  if (!validation.valid) throw new Error(validation.errors[0]);
  const entries = library.entries.slice();
  const seen = new Set();
  let firstId;
  for (const draft of drafts) {
    const term = normalizeSearch(draft.term);
    if (seen.has(term)) throw new Error("草稿中有重复的词，请检查后再保存。");
    seen.add(term);
    const index = entries.findIndex((entry) => normalizeSearch(entry.term) === term);
    let entry;
    if (index < 0) {
      entry = { ...draft, createdAt: updatedAt, updatedAt };
      entries.push(entry);
    } else {
      const previous = entries[index];
      entry = {
        ...previous, ...draft, id: previous.id, createdAt: previous.createdAt, updatedAt,
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
