const ENDPOINT = "https://api.dictionaryapi.dev/api/v2/entries/en/";

// Exact spellings always win. Only a dictionary miss warrants trying a lemma.
function lookupForms(term) {
  const word = term.trim().toLowerCase();
  const forms = [word];
  if (!/^[a-z]{4,}$/.test(word)) return forms;
  if (word.endsWith("ies") || word.endsWith("ied")) forms.push(word.slice(0, -3) + "y");
  if (word.endsWith("ing") || word.endsWith("ed")) {
    const stem = word.replace(/(?:ing|ed)$/, "");
    if (stem.length >= 2) {
      if (/([^aeiou])\1$/.test(stem)) forms.push(stem.slice(0, -1));
      forms.push(stem, stem + "e");
    }
  } else if (word.endsWith("s") && !word.endsWith("ss")) {
    if (/(?:ch|sh|ss|x|z|o)es$/.test(word)) forms.push(word.slice(0, -2));
    forms.push(word.slice(0, -1));
  }
  return [...new Set(forms)].slice(0, 4);
}

function sourceUrl(value, form) {
  if (!Array.isArray(value)) return "";
  for (const candidate of value) {
    try {
      const url = new URL(candidate);
      const title = decodeURIComponent(url.pathname).slice(6).replaceAll("_", " ");
      if (url.origin === "https://en.wiktionary.org" && !url.username && !url.password &&
          url.pathname.startsWith("/wiki/") && title.toLowerCase() === form) return url.href;
    } catch { /* Ignore malformed or unverified sources. */ }
  }
  return "";
}

function bounded(value, max) {
  return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : "";
}

export function extractSenses(records, form) {
  if (!Array.isArray(records)) return [];
  const groups = [];
  for (const record of records) {
    if (record?.word?.toLowerCase() !== form) continue;
    const url = sourceUrl(record.sourceUrls, form);
    if (!url) continue;
    const phonetic = bounded(record.phonetic, 200) ||
      (Array.isArray(record.phonetics) && record.phonetics.map((p) => bounded(p?.text, 200)).find(Boolean)) || "";
    const license = bounded(record.license?.name, 80);
    if (!license) continue;
    for (const meaning of record.meanings || []) {
      const partOfSpeech = bounded(meaning?.partOfSpeech, 100);
      if (!partOfSpeech || !Array.isArray(meaning.definitions)) continue;
      const group = [];
      for (const sense of meaning.definitions) {
        const definitionEn = bounded(sense?.definition, 2500);
        if (definitionEn) group.push({ form, partOfSpeech, definitionEn, example: bounded(sense.example, 1600),
          phonetic, url, license });
      }
      if (group.length) groups.push(group);
    }
  }
  // Balance parts of speech so a long noun entry does not hide the first verb sense.
  const senses = [];
  for (let depth = 0; depth < 12 && senses.length < 12; depth++) {
    for (const group of groups) if (group[depth] && senses.length < 12) senses.push(group[depth]);
  }
  return senses;
}

export async function lookupDictionary(term, fetchImpl = fetch) {
  const alternatives = [];
  const exact = term.trim().toLowerCase();
  for (const form of lookupForms(term)) {
    try {
      const response = await fetchImpl(ENDPOINT + encodeURIComponent(form), {
        redirect: "error", signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" },
      });
      if (response.status === 404) continue;
      if (!response.ok) break;
      const text = await response.text();
      if (text.length > 1_500_000) break;
      const senses = extractSenses(JSON.parse(text), form);
      if (senses.length && form === exact) return senses;
      // "routed" can lead to both "rout" and "route". Preserve both verified
      // alternatives so the selected sense can depend on the actual sentence.
      alternatives.push(...senses.slice(0, 6));
    } catch { break; }
  }
  return alternatives;
}
