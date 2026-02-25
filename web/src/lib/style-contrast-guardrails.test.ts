import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_SOURCE_ROOT = path.resolve(process.cwd(), "src/app");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const BANNED_UTILITY_CLASSES = [
  "text-white/90",
  "text-amber-100",
  "text-emerald-300",
  "border-white/15",
  "border-white/20",
];

function collectSourceFiles(directoryPath: string): string[] {
  const entries = readdirSync(directoryPath);
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry);
    const entryStats = statSync(entryPath);

    if (entryStats.isDirectory()) {
      files.push(...collectSourceFiles(entryPath));
      continue;
    }

    const extension = path.extname(entryPath);
    if (!SOURCE_EXTENSIONS.has(extension)) {
      continue;
    }

    if (entryPath.endsWith(".test.ts") || entryPath.endsWith(".test.tsx")) {
      continue;
    }

    files.push(entryPath);
  }

  return files;
}

describe("style contrast guardrails", () => {
  it("avoids low-contrast utility class regressions in app source", () => {
    const sourceFiles = collectSourceFiles(APP_SOURCE_ROOT);
    const violations: string[] = [];

    for (const filePath of sourceFiles) {
      const source = readFileSync(filePath, "utf8");
      for (const utilityClass of BANNED_UTILITY_CLASSES) {
        if (!source.includes(utilityClass)) {
          continue;
        }
        violations.push(`${path.relative(process.cwd(), filePath)} contains ${utilityClass}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
