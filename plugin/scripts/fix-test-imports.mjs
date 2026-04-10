import { readFile, writeFile } from "node:fs/promises";

const filePath = new URL("../dist-test/src/main/write.js", import.meta.url);
const source = await readFile(filePath, "utf8");
const updated = source.replace('"./serializer"', '"./serializer.js"');

if (updated !== source) {
  await writeFile(filePath, updated);
}
