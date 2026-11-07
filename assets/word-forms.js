import { findTermMatch, termKey } from "./draft-library.js?v=1.4.2";

const PARTS = { n: "noun", v: "verb", a: "adjective", r: "adverb" };
const EDITION = "Open English WordNet 2025";
const LABELS = {
  base: "独立词条", plural: "名词复数", "third-person": "动词第三人称单数",
  "past-or-participle": "过去式 / 过去分词", past: "过去式", participle: "过去分词",
  ing: "-ing 形式（现在分词 / 动名词）", comparative: "比较级", superlative: "最高级",
  irregular: "动词不规则变化形式", present: "现在时形式",
};
const VERB_LABELS = {
  am: "present", is: "third-person", are: "present", was: "past", were: "past", been: "participle",
  went: "past", gone: "participle", ran: "past", saw: "past", seen: "participle",
  did: "past", done: "participle", wrote: "past", written: "participle",
  spoke: "past", spoken: "participle", took: "past", taken: "participle",
  gave: "past", given: "participle", knew: "past", known: "participle",
  ate: "past", eaten: "participle", lay: "past", lain: "participle",
  got: "past-or-participle", gotten: "participle", came: "past", became: "past",
  grew: "past", grown: "participle", broke: "past", broken: "participle",
  chose: "past", chosen: "participle", drove: "past", driven: "participle",
  fell: "past", fallen: "participle", flew: "past", flown: "participle",
  forgot: "past", forgotten: "participle", rose: "past", risen: "participle",
  began: "past", begun: "participle", sang: "past", sung: "participle",
  drank: "past", drunk: "participle", swam: "past", swum: "participle",
  had: "past-or-participle", made: "past-or-participle", said: "past-or-participle",
  thought: "past-or-participle", bought: "past-or-participle", brought: "past-or-participle",
  found: "past-or-participle", felt: "past-or-participle", left: "past-or-participle",
  kept: "past-or-participle", held: "past-or-participle", told: "past-or-participle",
  sent: "past-or-participle", built: "past-or-participle", spent: "past-or-participle",
  learnt: "past-or-participle", met: "past-or-participle", heard: "past-or-participle",
  won: "past-or-participle", lost: "past-or-participle", paid: "past-or-participle",
};

const RULES = {
  n: [["s", "", "plural"], ["ses", "s", "plural"], ["xes", "x", "plural"],
    ["zes", "z", "plural"], ["ches", "ch", "plural"], ["shes", "sh", "plural"],
    ["men", "man", "plural"], ["ies", "y", "plural"]],
  v: [["s", "", "third-person"], ["ies", "y", "third-person"], ["es", "e", "third-person"],
    ["es", "", "third-person"], ["ed", "e", "past-or-participle"],
    ["ed", "", "past-or-participle"], ["ing", "e", "ing"], ["ing", "", "ing"]],
  a: [["er", "", "comparative"], ["est", "", "superlative"],
    ["er", "e", "comparative"], ["est", "e", "superlative"]],
  r: [],
};

function normalized(value) {
  return typeof value === "string" ? value.normalize("NFKC").toLowerCase().replaceAll("_", " ").replace(/\s+/gu, " ").trim() : "";
}

// The index contains only the pinned release's lemma/POS lists and exception
// tables. English definitions are kept in the server-side dictionary package.
export function createWordFormIndex(data) {
  if (data?.format !== 1 || data.edition !== EDITION) throw new Error("词形索引版本不正确。");
  const lemmas = Object.create(null);
  const exceptions = Object.create(null);
  for (const pos of Object.keys(PARTS)) {
    if (typeof data.lemmas?.[pos] !== "string" || !data.exceptions?.[pos] || Array.isArray(data.exceptions[pos])) {
      throw new Error("词形索引不完整。");
    }
    lemmas[pos] = new Set(data.lemmas[pos].split("\n").filter(Boolean));
    exceptions[pos] = new Map();
    for (const [surface, values] of Object.entries(data.exceptions[pos])) {
      if (!Array.isArray(values) || values.some(value => typeof value !== "string")) throw new Error("词形索引不完整。");
      exceptions[pos].set(surface, values.filter(lemma => lemmas[pos].has(lemma)));
    }
  }
  return { lemmas, exceptions };
}

let loadedIndex;
export function loadWordFormIndex() {
  loadedIndex ??= (async () => {
    const response = await fetch(new URL("../data/word-forms-2025.json", import.meta.url), { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("词形提示暂时不可用，可以继续按原词录入。");
    const text = await response.text();
    if (text.length > 2_100_000) throw new Error("词形索引大小不正确。");
    return createWordFormIndex(JSON.parse(text));
  })().catch(error => { loadedIndex = null; throw error; });
  return loadedIndex;
}

function exceptionForm(surface, pos) {
  if (pos === "n") return "plural";
  if (pos === "a" || pos === "r") {
    return /(?:est)$/.test(surface) || ["best", "worst", "most", "least"].includes(surface) ? "superlative" : "comparative";
  }
  if (Object.hasOwn(VERB_LABELS, surface)) return VERB_LABELS[surface];
  if (surface.endsWith("ing")) return "ing";
  if (surface.endsWith("ed")) return "past-or-participle";
  return "irregular";
}

function regularSurfaceMatches(surface, lemma, form) {
  const last = lemma.split(/\s/u).at(-1);
  const consonantY = /[^aeiou]y$/u.test(last);
  // Unambiguous one-vowel CVC words double the final consonant. More complex
  // stress-dependent spellings are supplied by WordNet's exception tables.
  const doubles = /^[^aeiou]*[aeiou][^aeiouwxy]$/u.test(last);
  if (form === "plural" || form === "third-person") {
    if (consonantY) return surface === lemma.slice(0, -1) + "ies";
    if (/(?:s|x|z|ch|sh)$/u.test(last)) return surface === lemma + "es";
    return surface === lemma + "s" || (last.endsWith("o") && surface === lemma + "es");
  }
  if (form === "ing") {
    if (last.endsWith("ie")) return surface === lemma.slice(0, -2) + "ying";
    if (/[^eoy]e$/u.test(last)) return surface === lemma.slice(0, -1) + "ing";
    return surface === lemma + (doubles ? last.at(-1) : "") + "ing";
  }
  if (form === "past-or-participle") {
    if (last.endsWith("e")) return surface === lemma + "d";
    if (consonantY) return surface === lemma.slice(0, -1) + "ied";
    return surface === lemma + (doubles ? last.at(-1) : "") + "ed";
  }
  if (form === "comparative" || form === "superlative") {
    const ending = form === "comparative" ? "er" : "est";
    if (consonantY) return surface === lemma.slice(0, -1) + "i" + ending;
    if (last.endsWith("e")) return surface === lemma + ending.slice(1);
    return surface === lemma + (doubles ? last.at(-1) : "") + ending;
  }
  return false;
}

// These are alternatives for the learner to review, not canonical entry keys.
// Exact noun/adjective meanings (learning, running, saw...) remain candidates.
// A regular rule is accepted only when OEWN confirms the lemma and that POS.
export function resolveWordForms(value, index) {
  const surface = normalized(value);
  if (!surface || surface.length > 120 || /[\u0000-\u001f]/u.test(surface)) return [];
  const matches = new Map();
  function add(lemma, pos, form, evidence) {
    if (lemma === surface && form !== "base") return;
    if (!index.lemmas[pos].has(lemma)) return;
    if (evidence === "lemma-rule" && !regularSurfaceMatches(surface, lemma, form)) return;
    const key = [lemma, pos, form].join("\n");
    if (matches.has(key)) return;
    matches.set(key, { lemma, partOfSpeech: PARTS[pos], form, label: LABELS[form], evidence,
      sourceUrl: "https://en-word.net/view/lemma/" + encodeURIComponent(lemma) });
  }
  for (const pos of Object.keys(PARTS)) add(surface, pos, "base", "exact");
  for (const pos of Object.keys(PARTS)) {
    const exceptional = index.exceptions[pos].get(surface);
    if (exceptional?.length) {
      for (const lemma of exceptional) add(lemma, pos, exceptionForm(surface, pos), "exception");
      continue;
    }
    for (const [ending, replacement, form] of RULES[pos]) {
      if (surface.endsWith(ending) && surface.length > ending.length + 1) {
        add(surface.slice(0, -ending.length) + replacement, pos, form, "lemma-rule");
      }
    }
    if (pos === "v" && /(?:ing|ed)$/u.test(surface)) {
      const stem = surface.replace(/(?:ing|ed)$/u, "");
      if (/([^aeiou\s])\1$/u.test(stem)) add(stem.slice(0, -1), pos,
        surface.endsWith("ing") ? "ing" : "past-or-participle", "lemma-rule");
    }
  }
  return [...matches.values()];
}

// A legacy entry may have been saved as a plural or verb form. Only offer it
// for a base-word request when all verified readings agree on that one lemma.
// Entries such as learning and saw have independent meanings and stay distinct.
export function findWordFormMatch(library, term, index) {
  const direct = findTermMatch(library, term);
  if (direct.kind !== "new" || !index) return direct;
  const key = termKey(term);
  if (!key) return direct;
  const candidates = library.entries.filter(entry => {
    const lemmas = new Set(resolveWordForms(entry.term, index).map(candidate => termKey(candidate.lemma)));
    return lemmas.size === 1 && lemmas.has(key) && termKey(entry.term) !== key;
  });
  if (candidates.length === 1) return { kind: "inflected", entry: candidates[0], candidates };
  if (candidates.length > 1) return { kind: "ambiguous", entry: null, candidates };
  return direct;
}
