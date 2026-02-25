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
        {
          selector:
            "Literal[value=/#(?:d8cdbb|c8a786|e5dece|e7dece|e7e0d2|ddd3c2|ddd4c4|d9cfbe|d8c8b9|d8d7cb|ddd6c8|e3c6b8|e4ddcf|d0c5b2|cfab8a|ccac8c|d7b79a|d3b092|cb9f82|cfad94|884a35|874934|8a4934|8c4b35|8f4934|8f4a35|844633|fdf1eb|fbe7dd|fbefe6|fbefe7|f9f3e8|f7f2e8|fff7f2|fdfbf7)/i]",
          message:
            "Use warm design token utilities (`border-default`, `border-accent`, `bg-accent-soft`, `text-accent`, `hover:*`) instead of hardcoded warm hex colors.",
        },
        {
          selector:
            "TemplateElement[value.raw=/#(?:d8cdbb|c8a786|e5dece|e7dece|e7e0d2|ddd3c2|ddd4c4|d9cfbe|d8c8b9|d8d7cb|ddd6c8|e3c6b8|e4ddcf|d0c5b2|cfab8a|ccac8c|d7b79a|d3b092|cb9f82|cfad94|884a35|874934|8a4934|8c4b35|8f4934|8f4a35|844633|fdf1eb|fbe7dd|fbefe6|fbefe7|f9f3e8|f7f2e8|fff7f2|fdfbf7)/i]",
          message:
            "Use warm design token utilities (`border-default`, `border-accent`, `bg-accent-soft`, `text-accent`, `hover:*`) instead of hardcoded warm hex colors.",
        },
        {
          selector:
            "Literal[value=/\\b(?:text-white\\/90|text-amber-100|text-emerald-300|border-white\\/15|border-white\\/20)\\b/]",
          message:
            "Avoid low-contrast utility classes (`text-white/90`, `text-amber-100`, `text-emerald-300`, `border-white/15`, `border-white/20`). Use semantic tokens (`text-accent-strong`, `status-warning`, `border-default`, `hover:border-accent`) instead.",
        },
        {
          selector:
            "TemplateElement[value.raw=/\\b(?:text-white\\/90|text-amber-100|text-emerald-300|border-white\\/15|border-white\\/20)\\b/]",
          message:
            "Avoid low-contrast utility classes (`text-white/90`, `text-amber-100`, `text-emerald-300`, `border-white/15`, `border-white/20`). Use semantic tokens (`text-accent-strong`, `status-warning`, `border-default`, `hover:border-accent`) instead.",
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
