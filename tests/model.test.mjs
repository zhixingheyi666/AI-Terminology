import test from "node:test";
import assert from "node:assert/strict";
import {
  collectTags,
  collectExampleTags,
  filterEntries,
  normalizeTags,
  sortEntriesByCreated,
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
        reviewTags: ["高频复习"],
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
            note: "Pay attention to the passive voice.",
            exampleTags: ["句法分析", "教材例句"],
            contextAnalysis: "The word describes factual support in retrieval.",
            grammarAnalysis: {
              structure: "Retrieval / improves / factual grounding.",
              parts: [
                {
                  label: "Retrieval",
                  explanation: "主语：检索。"
                }
              ],
              core: "Retrieval improves grounding.",
              rewrite: ""
            },
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
  assert.equal(filterEntries(entries, { query: "高频复习" }).length, 1);
  assert.equal(filterEntries(entries, { query: "factual support" }).length, 1);
  assert.equal(filterEntries(entries, { query: "主语" }).length, 1);
  assert.equal(filterEntries(entries, { query: "unrelated" }).length, 0);
});

test("filters status and tag", () => {
  const entries = validData().entries;
  assert.equal(filterEntries(entries, { status: "learning", tag: "ai" }).length, 1);
  assert.equal(filterEntries(entries, { tag: "高频复习" }).length, 1);
  assert.equal(filterEntries(entries, { reviewOnly: true }).length, 1);
  assert.equal(filterEntries(entries, { exampleTag: "句法分析" }).length, 1);
  assert.equal(filterEntries(entries, { exampleTag: "不存在的标签" }).length, 0);
  assert.equal(filterEntries(entries, { status: "mastered" }).length, 0);
});

test("orders entries by their original input time", () => {
  const entries = [
    { createdAt: "2026-10-31T00:00:00.000Z", term: "first" },
    { createdAt: "2026-10-31T03:18:00.000Z", term: "latest" },
    { createdAt: "2026-10-31T03:17:00.000Z", term: "middle" },
  ];
  assert.deepEqual(
    sortEntriesByCreated(entries).map((entry) => entry.term),
    ["latest", "middle", "first"],
  );
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

test("collects example tags with counts", () => {
  assert.deepEqual(
    collectExampleTags([
      {
        personalExamples: [
          { exampleTags: ["句法分析", "教材例句"] },
          { exampleTags: ["句法分析"] },
        ],
      },
    ]),
    [
      { label: "句法分析", count: 2 },
      { label: "教材例句", count: 1 },
    ],
  );
});
