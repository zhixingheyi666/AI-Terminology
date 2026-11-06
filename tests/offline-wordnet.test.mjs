import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { lookupOfflineWordnet, WORDNET_SOURCE, WORDNET_LICENSE } from "../scripts/offline-wordnet.mjs";
import { parseGloss, readPinnedZip } from "../scripts/build-offline-wordnet.mjs";

test("offline WordNet package has the pinned release and matches its checksum", async () => {
  const manifest = JSON.parse(await readFile(new URL("../scripts/offline-wordnet-manifest.json", import.meta.url), "utf8"));
  const bytes = await readFile(new URL("../scripts/offline-wordnet-2025.json.gz", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.sha256);
  assert.equal(manifest.sourceSha256, "38b16326159f51853626b7d24a44c453fa88ab33f06fce5ec8fc5996d1c2be93");
  assert.ok(bytes.length < 10_000_000);
  const data = JSON.parse(gunzipSync(bytes).toString("utf8"));
  assert.equal(data.edition, WORDNET_SOURCE);
  assert.equal(Object.keys(data.entries).length, manifest.entries);
  assert.equal(Object.keys(data.synsets).length, 107519);
  for (const license of manifest.licenses) {
    const text = await readFile(new URL(`../scripts/${license.file}`, import.meta.url));
    assert.equal(createHash("sha256").update(text).digest("hex"), license.sha256);
    assert.match(text.toString("utf8"), /Princeton/);
  }
});

test("verified sample words retain all genuine senses, parts and source attribution", async () => {
  const counts = { raw: 14, entity: 1, schemes: 7, intuition: 2 };
  for (const [term, count] of Object.entries(counts)) {
    const senses = await lookupOfflineWordnet(term);
    assert.equal(senses.length, count);
    for (const sense of senses) {
      assert.equal(sense.provider, "wordnet");
      assert.equal(sense.sourceName, WORDNET_SOURCE);
      assert.equal(sense.license, WORDNET_LICENSE);
      assert.equal(sense.phonetic, "");
      assert.ok(sense.definitionEn.length > 0);
      assert.ok(sense.url.startsWith("https://en-word.net/view/lemma/"));
      assert.equal(sense.example, sense.examples[0] || "");
      assert.ok(Number.isInteger(sense.senseNumber));
    }
    assert.equal(new Set(senses.map((sense) => sense.url)).size, 1);
  }
  const entity = await lookupOfflineWordnet("entity");
  assert.equal(entity[0].definitionEn,
    "that which is perceived or known or inferred to have its own distinct existence (living or nonliving)");
  const raw = await lookupOfflineWordnet("raw");
  assert.equal(raw.filter((sense) => sense.partOfSpeech === "adjective").length, 13);
  assert.equal(raw.filter((sense) => sense.partOfSpeech === "noun").length, 1);
  const intuition = await lookupOfflineWordnet("intuition");
  assert.deepEqual(intuition.map((sense) => sense.senseNumber), [1, 2]);
  assert.ok(intuition.some((sense) => sense.example === "he had an intuition that something had gone wrong"));
});

test("grasping retains its exact senses and the contextual verb grasp", async () => {
  const senses = await lookupOfflineWordnet("grasping");
  assert.ok(senses.some((sense) => sense.form === "grasping" && sense.partOfSpeech === "adjective"));
  assert.ok(senses.some((sense) => sense.form === "grasp" && sense.partOfSpeech === "verb" &&
    /meaning|understand|comprehend/.test(sense.definitionEn)));
  assert.ok(senses.some((sense) => sense.form === "grasp" && sense.partOfSpeech === "verb" && /hold/.test(sense.definitionEn)));
  assert.ok(senses.some((sense) => sense.form === "grasp" && sense.partOfSpeech === "noun"));
  assert.equal(senses.filter((sense) => sense.form === "grasp")[0].partOfSpeech, "verb");
});

test("official exception tables and checked morphology support common word forms", async () => {
  assert.ok((await lookupOfflineWordnet("children")).some((sense) => sense.form === "child"));
  assert.ok((await lookupOfflineWordnet("went")).some((sense) => sense.form === "go" && sense.partOfSpeech === "verb"));
  assert.ok((await lookupOfflineWordnet("bigger")).some((sense) => sense.form === "big" && sense.partOfSpeech === "adjective"));
  assert.ok((await lookupOfflineWordnet("running")).some((sense) => sense.form === "run" && sense.partOfSpeech === "verb"));
  assert.ok((await lookupOfflineWordnet("stopped")).some((sense) => sense.form === "stop"));
  assert.ok((await lookupOfflineWordnet("raw_material")).every((sense) =>
    sense.url === "https://en-word.net/view/lemma/raw%20material"));
});

test("unknown or malformed input returns no senses and prototype-named words are safe", async () => {
  for (const term of ["notarealenglishwordqzxv", "__proto__", "", null, "x".repeat(121), "../entity", "entity?x=1"]) {
    assert.deepEqual(await lookupOfflineWordnet(term), []);
  }
  assert.ok((await lookupOfflineWordnet("constructor")).length > 0);
  const first = await lookupOfflineWordnet("intuition");
  first[1].examples.push("not a dictionary quotation");
  assert.ok(!(await lookupOfflineWordnet("intuition"))[1].examples.includes("not a dictionary quotation"));
});

test("gloss parsing preserves source definition, examples and author suffixes", () => {
  assert.deepEqual(parseGloss('a definition; another clause; "one example"; "two examples"'),
    ["a definition; another clause", ["one example", "two examples"]]);
  assert.deepEqual(parseGloss('a definition; "an example" - Author'), ["a definition", ['"an example" - Author']]);
  assert.deepEqual(parseGloss("a definition without an example"), ["a definition without an example", []]);
  assert.throws(() => readPinnedZip(Buffer.from("untrusted archive")), /SHA-256/);
});
