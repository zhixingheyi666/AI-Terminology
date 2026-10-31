import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateData } from "../assets/model.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultDataPath = path.resolve(scriptDirectory, "../data/vocabulary.json");
const dataPath = path.resolve(process.argv[2] || defaultDataPath);

try {
  const source = await readFile(dataPath, "utf8");
  const data = JSON.parse(source);
  const result = validateData(data);

  for (const warning of result.warnings) {
    console.warn(`WARNING: ${warning}`);
  }

  if (!result.valid) {
    for (const error of result.errors) {
      console.error(`ERROR: ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log(
      `Valid vocabulary data: ${data.entries.length} entries in ${path.relative(process.cwd(), dataPath)}`,
    );
  }
} catch (error) {
  console.error(`Unable to validate ${dataPath}: ${error.message}`);
  process.exitCode = 1;
}
