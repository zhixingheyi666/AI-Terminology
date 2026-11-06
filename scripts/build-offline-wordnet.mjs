import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { inflateRawSync, gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCE_URL = "https://en-word.net/downloads/english-wordnet-2025.zip";
export const SOURCE_SHA256 = "38b16326159f51853626b7d24a44c453fa88ab33f06fce5ec8fc5996d1c2be93";
const LICENSE_COMMIT = "dc343f2683279ecbb13fab4e2fd778d7b162d287";
const OUTPUT = new URL("./offline-wordnet-2025.json.gz", import.meta.url);
const MANIFEST = new URL("./offline-wordnet-manifest.json", import.meta.url);
const PARTS = [["noun", "n"], ["verb", "v"], ["adj", "a"], ["adv", "r"]];

// The one pinned official archive is a small, non-ZIP64 archive. Read only the
// required members in memory; never extract arbitrary archive paths to disk.
export function readPinnedZip(archive) {
  if (archive.length > 12_000_000 || createHash("sha256").update(archive).digest("hex") !== SOURCE_SHA256) {
    throw new Error("The official WordNet archive SHA-256 does not match the pinned 2025 release.");
  }
  let end = -1;
  for (let p = archive.length - 22; p >= Math.max(0, archive.length - 65557); p--) {
    if (archive.readUInt32LE(p) === 0x06054b50) { end = p; break; }
  }
  if (end < 0 || archive.readUInt16LE(end + 4) || archive.readUInt16LE(end + 6)) throw new Error("Unsupported archive.");
  const files = new Map();
  let cursor = archive.readUInt32LE(end + 16);
  for (let count = 0; count < archive.readUInt16LE(end + 10); count++) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Invalid ZIP directory.");
    const method = archive.readUInt16LE(cursor + 10);
    const size = archive.readUInt32LE(cursor + 20);
    const unpackedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const local = archive.readUInt32LE(cursor + 42);
    const name = archive.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!/^oewn2025\/(?:data\.(?:noun|verb|adj|adv)|index\.(?:noun|verb|adj|adv)|(?:noun|verb|adj|adv)\.exc)$/.test(name)) continue;
    if (unpackedSize > 20_000_000 || archive.readUInt32LE(local) !== 0x04034b50) throw new Error("Invalid member.");
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const compressed = archive.subarray(start, start + size);
    const bytes = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed, { maxOutputLength: 20_000_000 }) : null;
    if (!bytes || bytes.length !== unpackedSize) throw new Error("Invalid member size or compression.");
    files.set(name.slice("oewn2025/".length), bytes.toString("utf8"));
  }
  if (files.size !== 12) throw new Error("Required WNDB files are missing.");
  return files;
}

export function parseGloss(gloss) {
  const text = gloss.trim();
  const firstExample = /;\s*"/.exec(text);
  if (!firstExample) return [text, []];
  const definition = text.slice(0, firstExample.index).trim();
  const examples = text.slice(firstExample.index).replace(/^;\s*/, "").split(/;\s*(?=")/).map((value) => {
    const example = value.trim();
    // Preserve author/source suffixes verbatim. Strip only a complete pair of
    // outer example delimiters, never punctuation inside the quotation.
    return example.startsWith('"') && example.endsWith('"') ? example.slice(1, -1) : example;
  });
  return [definition, examples];
}

export function compileWordnet(files) {
  const synsets = Object.create(null);
  const entries = Object.create(null);
  const exceptions = Object.create(null);
  for (const [suffix, pos] of PARTS) {
    for (const line of files.get(`data.${suffix}`).split(/\r?\n/u)) {
      if (!/^\d{8} /u.test(line)) continue;
      const fields = line.slice(0, line.indexOf("|")).trim().split(/\s+/u);
      if (![pos, ...(pos === "a" ? ["s"] : [])].includes(fields[2])) throw new Error("Invalid WNDB part of speech.");
      const gloss = parseGloss(line.slice(line.indexOf("|") + 1));
      if (!gloss[0]) throw new Error("Empty source definition.");
      synsets[`${pos}:${fields[0]}`] = gloss;
    }
    for (const line of files.get(`index.${suffix}`).split(/\r?\n/u)) {
      if (!line || /^\s/u.test(line)) continue;
      const fields = line.trim().split(/\s+/u);
      const count = Number(fields[2]);
      const pointers = Number(fields[3]);
      const offsets = fields.slice(6 + pointers);
      if (fields[1] !== pos || offsets.length !== count || offsets.some((offset) => !synsets[`${pos}:${offset}`])) {
        throw new Error("Invalid WNDB lemma index.");
      }
      const lemma = fields[0].replaceAll("_", " ").toLowerCase();
      entries[lemma] ??= [];
      const group = entries[lemma].find(([part]) => part === pos);
      if (group) group[1].push(...offsets.filter((offset) => !group[1].includes(offset)));
      else entries[lemma].push([pos, offsets]);
    }
    exceptions[pos] = Object.create(null);
    for (const line of files.get(`${suffix}.exc`).split(/\r?\n/u)) {
      if (!line.trim()) continue;
      const [form, ...lemmas] = line.trim().toLowerCase().split(/\s+/u).map((value) => value.replaceAll("_", " "));
      exceptions[pos][form] = lemmas;
    }
  }
  const orderedEntries = Object.fromEntries(Object.keys(entries).sort().map((lemma) => [lemma, entries[lemma]]));
  return { format: 1, edition: "Open English WordNet 2025", sourceSha256: SOURCE_SHA256,
    entries: orderedEntries, synsets, exceptions };
}

export async function buildOfflineWordnet(zipPath) {
  let archive;
  if (zipPath) archive = await readFile(zipPath);
  else {
    const response = await fetch(SOURCE_URL, { redirect: "error", signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error("Official WordNet download failed.");
    archive = Buffer.from(await response.arrayBuffer());
  }
  const data = compileWordnet(readPinnedZip(archive));
  const raw = Buffer.from(JSON.stringify(data) + "\n");
  const compressed = gzipSync(raw, { level: 9 });
  if (compressed.length > 10_000_000) throw new Error("Offline WordNet exceeds the package size budget.");
  const licenses = [];
  for (const [file, upstream, sha256] of [
    ["offline-wordnet-LICENSE.txt", "LICENSE.md", "672cc8b5663e8dc74c4b07a9dcf477193853575b119908fd3dc0aeeb60a9dbbb"],
    ["offline-wordnet-WNDB-LICENSE.txt", "WNDB_License.txt", "df30ec18fbabcdaf031b79ea026d3e6b959010cffe6dd7be9ac137822175b904"],
  ]) {
    const bytes = await readFile(new URL(`./${file}`, import.meta.url));
    if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error("Vendored WordNet license does not match.");
    licenses.push({ file, sha256, source: `https://raw.githubusercontent.com/globalwordnet/english-wordnet/${LICENSE_COMMIT}/${upstream}` });
  }
  const manifest = { format: 1, edition: data.edition, sourceUrl: SOURCE_URL, sourceSha256: SOURCE_SHA256,
    sourceBytes: archive.length, sourceCodeCommit: LICENSE_COMMIT,
    file: "offline-wordnet-2025.json.gz", sha256: createHash("sha256").update(compressed).digest("hex"),
    bytes: compressed.length, uncompressedBytes: raw.length, entries: Object.keys(data.entries).length,
    synsets: Object.keys(data.synsets).length, licenses };
  await writeFile(OUTPUT, compressed);
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifest = await buildOfflineWordnet(process.argv[2]);
    console.log(`Built ${manifest.edition}: ${manifest.entries} lemmas, ${manifest.synsets} synsets, ${manifest.bytes} compressed bytes.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
