import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

const unzip = promisify(gunzip);
const PARTS = { n: "noun", v: "verb", a: "adjective", r: "adverb" };
export const WORDNET_SOURCE = "Open English WordNet 2025";
export const WORDNET_LICENSE = "CC BY 4.0 · Open English WordNet · derived from Princeton WordNet";
let database;

async function loadDatabase() {
  database ??= (async () => {
    const [bytes, manifestText] = await Promise.all([
      readFile(new URL("./offline-wordnet-2025.json.gz", import.meta.url)),
      readFile(new URL("./offline-wordnet-manifest.json", import.meta.url), "utf8"),
    ]);
    const manifest = JSON.parse(manifestText);
    if (bytes.length !== manifest.bytes || createHash("sha256").update(bytes).digest("hex") !== manifest.sha256) {
      throw new Error("Offline WordNet integrity check failed.");
    }
    const data = JSON.parse((await unzip(bytes, { maxOutputLength: 40_000_000 })).toString("utf8"));
    if (data.format !== 1 || data.edition !== WORDNET_SOURCE || data.sourceSha256 !== manifest.sourceSha256) {
      throw new Error("Offline WordNet version is invalid.");
    }
    return data;
  })();
  return database;
}

const RULES = {
  n: [["s", ""], ["ses", "s"], ["xes", "x"], ["zes", "z"], ["ches", "ch"], ["shes", "sh"], ["men", "man"], ["ies", "y"]],
  v: [["s", ""], ["ies", "y"], ["es", "e"], ["es", ""], ["ed", "e"], ["ed", ""], ["ing", "e"], ["ing", ""]],
  a: [["er", ""], ["est", ""], ["er", "e"], ["est", "e"]], r: [],
};

function formsFor(term, data) {
  const forms = new Map();
  if (Object.hasOwn(data.entries, term)) forms.set(term, new Set(Object.keys(PARTS)));
  for (const pos of Object.keys(PARTS)) {
    const candidates = [...(Object.hasOwn(data.exceptions[pos], term) ? data.exceptions[pos][term] : [])];
    for (const [ending, replacement] of RULES[pos]) {
      if (term.endsWith(ending) && term.length > ending.length + 1) candidates.push(term.slice(0, -ending.length) + replacement);
    }
    // WNDB's exception tables handle common irregulars. A validated extra rule
    // covers doubled final consonants (running -> run, stopped -> stop).
    if (pos === "v" && /(?:ing|ed)$/u.test(term)) {
      const stem = term.replace(/(?:ing|ed)$/u, "");
      if (/([^aeiou\s])\1$/u.test(stem)) candidates.push(stem.slice(0, -1));
    }
    for (const form of candidates) {
      if (!Object.hasOwn(data.entries, form) || !data.entries[form].some(([part]) => part === pos)) continue;
      if (!forms.has(form)) forms.set(form, new Set());
      forms.get(form).add(pos);
    }
  }
  return [...forms];
}

export async function lookupOfflineWordnet(term) {
  if (typeof term !== "string" || term.length > 120 || !term.trim() || /[\u0000-\u001f\/\\?#]/u.test(term)) return [];
  const word = term.normalize("NFKC").trim().toLowerCase().replaceAll("_", " ").replace(/\s+/gu, " ");
  const data = await loadDatabase();
  const senses = [];
  for (const [form, matchedParts] of formsFor(word, data)) {
    // Once morphology is validated for a real lemma/POS, keep that lemma's
    // other genuine parts too. The matching POS comes first (grasping -> grasp
    // verb), followed by the same lemma's noun senses for the basic-meaning view.
    const groups = [...data.entries[form].filter(([pos]) => matchedParts.has(pos)),
      ...data.entries[form].filter(([pos]) => !matchedParts.has(pos))];
    for (const [pos, offsets] of groups) {
      offsets.forEach((offset, index) => {
        const [definitionEn, examples] = data.synsets[`${pos}:${offset}`];
        senses.push({ form, partOfSpeech: PARTS[pos], definitionEn, example: examples[0] || "", examples: [...examples],
          phonetic: "", url: `https://en-word.net/view/lemma/${encodeURIComponent(form)}`,
          license: WORDNET_LICENSE, provider: "wordnet", sourceName: WORDNET_SOURCE,
          // This is the release-specific WNDB identifier, not an invented web ID.
          synsetId: `oewn-2025-wndb-${offset}-${pos}`, senseNumber: index + 1 });
      });
    }
  }
  return senses;
}
