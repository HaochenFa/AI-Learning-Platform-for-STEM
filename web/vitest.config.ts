import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(async () => {
  const { default: tsconfigPaths } = await import("vite-tsconfig-paths");

  return {
    plugins: [tsconfigPaths()],
    resolve: {
      alias: {
        "server-only": path.resolve(rootDir, "src/test/mocks/server-only.ts"),
        "next/link": path.resolve(rootDir, "src/test/mocks/next-link.tsx"),
      },
    },
    test: {
      environment: "node",
      include: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/**/*.spec.ts",
        "src/**/*.spec.tsx",
      ],
      clearMocks: true,
      globals: true,
    },
  };
});
