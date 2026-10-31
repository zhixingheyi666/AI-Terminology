import test from "node:test";
import assert from "node:assert/strict";
import {
  collectTags,
  filterEntries,
  normalizeTags,
  validateData,
} from "../assets/model.js";

function validData() {
  return {
    schemaVersion: 1,
    updatedAt: "2026-10-31T00:00:00.000Z",
    entries: [
      {
        id: "entry-1",
        term: "grounding",
        phonetic: "/ˈɡraʊndɪŋ/",
        status: "learning",
        tags: ["AI", "NLP"],
        definitions: [
          {
            id: "definition-1",
            dictionary: "Oxford",
            partOfSpeech: "noun",
            definitionEn: "A basis in reality.",
            definitionZh: "现实基础。",
            url: "https://example.com",
            examples: [{ en: "The claim needs grounding.", zh: "这个主张需要依据。" }],
          },
        ],
        personalExamples: [
          {
            id: "encounter-1",
            en: "Retrieval improves factual grounding.",
            zh: "检索改善了事实依据。",
            source: "paper",
            encounteredAt: "2026-10-30",
            note: "",
          },
        ],
        notes: "",
        createdAt: "2026-10-31T00:00:00.000Z",
        updatedAt: "2026-10-31T00:00:00.000Z",
      },
    ],
  };
}

test("accepts valid vocabulary data", () => {
  assert.equal(validateData(validData()).valid, true);
});

test("rejects duplicate ids", () => {
  const data = validData();
  data.entries[0].definitions[0].id = data.entries[0].id;
  const result = validateData(data);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /id 重复/);
});

test("searches dictionary definitions and personal source", () => {
  const entries = validData().entries;
  assert.equal(filterEntries(entries, { query: "现实" }).length, 1);
  assert.equal(filterEntries(entries, { query: "paper retrieval" }).length, 1);
  assert.equal(filterEntries(entries, { query: "unrelated" }).length, 0);
});

test("filters status and tag", () => {
  const entries = validData().entries;
  assert.equal(filterEntries(entries, { status: "learning", tag: "ai" }).length, 1);
  assert.equal(filterEntries(entries, { status: "mastered" }).length, 0);
});

test("normalizes and deduplicates tags", () => {
  assert.deepEqual(normalizeTags(["AI", " ai ", "#NLP", ""]), ["AI", "NLP"]);
  assert.deepEqual(
    collectTags([
      { tags: ["AI", "NLP"] },
      { tags: ["AI"] },
    ]),
    [
      { label: "AI", count: 2 },
      { label: "NLP", count: 1 },
    ],
  );
});
