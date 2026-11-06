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

export function extractSenses(records, form, onLimit = () => {}) {
  if (!Array.isArray(records)) return [];
  const senses = new Map();
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
      for (const sense of meaning.definitions) {
        const definitionEn = bounded(sense?.definition, 2500);
        if (!definitionEn) {
          if (sense?.definition?.length > 2500) onLimit("个别超长义项请查阅词典原页。");
          continue;
        }
        const example = bounded(sense.example, 1600);
        if (sense.example?.length > 1600) onLimit("个别超长例句请查阅词典原页。");
        const key = [url, license, partOfSpeech, definitionEn].map((text) =>
          text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ")).join("\u0000");
        const previous = senses.get(key);
        if (!previous) senses.set(key, { form, partOfSpeech, definitionEn, example, phonetic, url, license });
        else if (!previous.example && example) previous.example = example;
      }
    }
  }
  return [...senses.values()];
}

export async function lookupDictionary(term, fetchImpl = fetch, onLimit = () => {}) {
  let surface = [];
  const alternatives = [];
  const exact = term.trim().toLowerCase();
  const forms = lookupForms(term);
  const linkedBases = new Set();
  for (const form of forms) {
    if (surface.length && !linkedBases.has(form)) continue;
    try {
      const response = await fetchImpl(ENDPOINT + encodeURIComponent(form), {
        redirect: "error", signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" },
      });
      if (response.status === 404) continue;
      if (!response.ok) {
        onLimit(response.status === 429 ? "在线词典暂时限制请求。" : "在线词典服务暂时无法响应。");
        break;
      }
      const text = await response.text();
      if (text.length > 1_500_000) {
        onLimit("词典响应超过读取上限，完整义项可查阅 Wiktionary 原条。");
        break;
      }
      const records = JSON.parse(text);
      const senses = extractSenses(records, form, onLimit);
      if (senses.length && form === exact) {
        // The API sometimes pools lemma and inflected-form glosses (grasping).
        // Confirm the linked lemma directly before attributing those glosses.
        for (const base of forms.slice(1)) {
          if (records.some((record) => sourceUrl(record?.sourceUrls, base))) linkedBases.add(base);
        }
        if (!linkedBases.size) return senses;
        surface = senses;
        continue;
      }
      // "routed" can lead to both "rout" and "route". Preserve both verified
      // alternatives so the selected sense can depend on the actual sentence.
      alternatives.push(...senses);
    } catch {
      onLimit("在线词典连接失败或未返回可读取的数据。");
      break;
    }
  }
  const glossKey = (sense) => sense.partOfSpeech + "|" + sense.definitionEn;
  const baseGlosses = new Set(alternatives.map(glossKey));
  return [...surface.filter((sense) => !baseGlosses.has(glossKey(sense))), ...alternatives];
}
