import test from "node:test";
import assert from "node:assert/strict";
import { draftErrorCode, generateDraft } from "../scripts/generate-draft.mjs";

const request = {
  terms: ["machine-learning", "speak"],
  sentence: "That’s machine-learning speak for passing the inputs through a model.",
  source: "", detailed: false,
};
const translation = "用机器学习的术语来说，就是把输入传入模型。";
function word(term, targetIndex) {
  return { term, targetIndex, partOfSpeech: "noun", definitionEn: "Definition for " + term,
    definitionZh: "释义：" + term, notes: "词级提示", tags: ["机器学习"],
    examples: [{ en: "Example for " + term, zh: "例句译文" }] };
}
function harness(responses) {
  const requests = [];
  const options = { apiKey: "mock", data: { entries: [] }, lookupOfflineWordnet: async () => [],
    fetchImpl: async (url, init) => {
      if (url.startsWith("https://api.dictionaryapi.dev/")) return new Response(null, { status: 404 });
      const input = JSON.parse(JSON.parse(init.body).messages[1].content);
      requests.push(input);
      const result = responses[requests.length - 1];
      if (typeof result !== "function") throw new Error("Unplanned mock request");
      const data = result(input);
      if (data instanceof Response) return data;
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(data) } }] });
    } };
  return { requests, run: (overrides = {}) => generateDraft({ ...request, ...overrides }, options) };
}

test("distinguishes truncated, malformed and unreadable completions without guessing missing JSON", async () => {
  for (const [finish, content, code] of [
    ["length", '{"translation":', "MODEL_TRUNCATED"], ["stop", "  ", "MODEL_JSON"],
    ["stop", 'Here is JSON: {}', "MODEL_JSON"], ["stop", "[]", "MODEL_FORMAT"],
  ]) {
    const suite = harness([() => Response.json({ choices: [{ finish_reason: finish, message: {content} }] })]);
    await assert.rejects(suite.run(), e => draftErrorCode(e) === code);
    assert.equal(suite.requests.length, 1);
  }
  const whole = { translation, words: request.terms.map((term, i) => word(term, i)) };
  const wrapped = ["```json", JSON.stringify(whole), "```"].join("\n");
  const suite = harness([() => Response.json({ choices: [{ finish_reason: "stop", message: {content: wrapped} }] })]);
  assert.equal((await suite.run()).entries.length, 2);
});

test("unique hyphen/space and Unicode spelling variants match in any response order without changing original targets", async () => {
  for (const useIds of [true, false]) {
    const suite = harness([({ targets }) => {
      assert.deepEqual(targets, [{ targetIndex: 0, term: "machine-learning" }, { targetIndex: 1, term: "speak" }]);
      return { translation, words: [word(" SPEAK ", useIds ? 1 : undefined), word("Machine Learning", useIds ? "0" : undefined)] };
    }]);
    const { entries } = await suite.run();
    assert.deepEqual(entries.map((e) => e.term), request.terms);
    assert.equal(entries[0].definitions[0].definitionEn, "Definition for Machine Learning");
    assert.equal(entries[1].personalExamples[0].en, request.sentence);
    assert.equal(suite.requests.length, 1);
  }
});

test("a single targeted repair recovers an omitted target with the first translation", async () => {
  const suite = harness([
    () => ({ translation, words: [word("speak", 1)] }),
    (input) => {
      assert.deepEqual(input.targets, [{ targetIndex: 0, term: "machine-learning" }]);
      assert.deepEqual(input.terms, ["machine-learning"]);
      assert.equal(input.sharedTranslation, translation);
      return { words: [word("machine‐learning", 0)], translation: "不要覆盖第一次的翻译" };
    },
  ]);
  const { entries, missingTerms } = await suite.run();
  assert.equal(missingTerms, undefined);
  assert.deepEqual(entries.map((e) => e.term), request.terms);
  assert.ok(entries.every((e) => e.personalExamples[0].zh === translation));
  assert.equal(suite.requests.length, 2);
});

test("failed targeted repair leaves a useful partial draft for recoverable terms only", async () => {
  const suite = harness([
    () => ({ translation, words: [{ ...word("machine-learning", 0), definitionZh: "" }, word("speak", 1)] }),
    () => new Response(null, { status: 429 }),
  ]);
  const draft = await suite.run();
  assert.deepEqual(suite.requests.map((r) => r.terms), [request.terms, ["machine-learning"]]);
  assert.deepEqual(draft.entries.map((e) => e.term), ["speak"]);
  assert.deepEqual(draft.missingTerms, ["machine-learning"]);
});

test("a duplicate, invented term or spelling of an already completed sibling cannot be assigned to the missing target", async () => {
  const suite = harness([
    () => ({ translation, words: [word("fine tuning", 1), word("fine-tuning", 0), word("fine-tuning", 0), word("speak", 2)] }),
    () => ({ words: [word("fine tuning", 0), word("unrelated", 0)] }),
  ]);
  const draft = await suite.run({ terms: ["fine-tuning", "fine tuning", "speak"] });
  assert.deepEqual(suite.requests[1].terms, ["fine-tuning"]);
  assert.deepEqual(draft.missingTerms, ["fine-tuning"]);
  assert.deepEqual(draft.entries.map((e) => e.term), ["fine tuning", "speak"]);
});

test("rejects globally unusable responses with specific safe codes and does not charge for a full automatic replay", async () => {
  for (const [value, code] of [
    [{ translation, words: [word("unrelated", 0)] }, "TERM_MISMATCH"],
    [{ translation, words: [{ ...word("speak", 1), definitionEn: "" }] }, "WORD_FIELDS"],
    [{ translation, words: [word("speak", 0), word("machine-learning", 1)] }, "TERM_MISMATCH"],
    [{ translation, words: {} }, "MODEL_FORMAT"],
    [{ words: [word("speak", 1)] }, "SHARED_TRANSLATION"],
  ]) {
    const suite = harness([() => value]);
    await assert.rejects(suite.run(), (e) => draftErrorCode(e) === code);
    assert.equal(suite.requests.length, 1);
  }
});
