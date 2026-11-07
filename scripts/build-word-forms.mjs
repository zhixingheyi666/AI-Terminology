import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export async function buildWordForms() {
  const manifest = JSON.parse(await readFile(new URL("scripts/offline-wordnet-manifest.json", ROOT), "utf8"));
  const bytes = await readFile(new URL("scripts/offline-wordnet-2025.json.gz", ROOT));
  if (bytes.length !== manifest.bytes || sha256(bytes) !== manifest.sha256) throw new Error("WordNet source integrity check failed.");
  const database = JSON.parse(gunzipSync(bytes, { maxOutputLength: 40_000_000 }));
  if (database.format !== 1 || database.edition !== manifest.edition || database.sourceSha256 !== manifest.sourceSha256) {
    throw new Error("Unexpected WordNet source version.");
  }
  const lemmas = {};
  for (const pos of ["n", "v", "a", "r"]) {
    lemmas[pos] = Object.entries(database.entries).filter(([, groups]) => groups.some(([part]) => part === pos))
      .map(([lemma]) => lemma).sort().join("\n");
  }
  const licenses = [];
  for (const license of manifest.licenses) {
    const source = await readFile(new URL("scripts/" + license.file, ROOT));
    if (sha256(source) !== license.sha256) throw new Error("WordNet license integrity check failed.");
    const file = license.file.replace("offline-wordnet", "word-forms");
    await writeFile(new URL("data/" + file, ROOT), source);
    licenses.push({ ...license, file });
  }
  const compact = { format: 1, edition: database.edition,
    attribution: "Open English WordNet team; derived from Princeton WordNet; CC BY 4.0",
    modification: "Lemma and part-of-speech index plus original exception tables; definitions and semantic relations omitted.",
    sourceUrl: manifest.sourceUrl, sourceSha256: manifest.sourceSha256, sourceDatabaseSha256: manifest.sha256,
    licenses, lemmas, exceptions: database.exceptions };
  const output = Buffer.from(JSON.stringify(compact) + "\n");
  if (output.length > 2_000_000) throw new Error("Browser word-form index exceeds the 2 MB budget.");
  await writeFile(new URL("data/word-forms-2025.json", ROOT), output);
  return { bytes: output.length, sha256: sha256(output), lemmas: Object.keys(database.entries).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildWordForms();
  console.log(JSON.stringify(result));
}
