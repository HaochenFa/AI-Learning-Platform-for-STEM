import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/\\b(?:border-slate-\\d+|bg-slate-\\d+|text-slate-\\d+|focus:border-cyan|focus:ring-cyan|bg-cyan-\\d+)\\b/]",
          message:
            "Use warm design system utilities/tokens (`text-ui-*`, `border-default`, `bg-accent*`, `focus-ring-warm`) instead of raw slate/cyan classes in className strings.",
        },
        {
          selector:
            "TemplateElement[value.raw=/\\b(?:border-slate-\\d+|bg-slate-\\d+|text-slate-\\d+|focus:border-cyan|focus:ring-cyan|bg-cyan-\\d+)\\b/]",
          message:
            "Use warm design system utilities/tokens (`text-ui-*`, `border-default`, `bg-accent*`, `focus-ring-warm`) instead of raw slate/cyan classes in className templates.",
        },
        {
          selector: "Literal[value=/border-\\[#(?:e6dece|e5d2c4|ddd2c2|dfd5c4)\\]/]",
          message: "Use `border-default` (token) instead of hardcoded warm border hex values.",
        },
        {
          selector: "TemplateElement[value.raw=/border-\\[#(?:e6dece|e5d2c4|ddd2c2|dfd5c4)\\]/]",
          message: "Use `border-default` (token) instead of hardcoded warm border hex values.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
