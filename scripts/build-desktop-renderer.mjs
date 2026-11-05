import { readFile, writeFile } from "node:fs/promises";
import ts from "typescript";

const sourcePath = new URL("../src/legacy/desktop-renderer.ts", import.meta.url);
const outputPath = new URL("../public/desktop-renderer.js", import.meta.url);
const source = await readFile(sourcePath, "utf8");
const output = ts.transpile(
  source,
  {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
    removeComments: false,
    sourceMap: false,
  },
  sourcePath.pathname,
);

await writeFile(outputPath, output, "utf8");
console.log("Built public/desktop-renderer.js");
