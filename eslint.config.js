import importPlugin from "eslint-plugin-import";
import tsParser from "@typescript-eslint/parser";

const layeringRules = {
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        {
          group: ["@nhonh/core/internal", "@nhonh/core/internal/*"],
          message:
            "Layering violation: only @nhonh/core public exports may be imported. core/internal is private.",
        },
        {
          group: ["playwright/types/protocol", "puppeteer-core/lib/cjs/puppeteer/api/protocol*"],
          message:
            "Layering violation: CDP Protocol types must not appear outside packages/driver-*. Translate to @nhonh/core domain types at the boundary.",
        },
      ],
    },
  ],
};

const viewerRestriction = {
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        {
          group: [
            "@nhonh/driver-playwright",
            "@nhonh/driver-playwright/*",
            "@nhonh/driver-extension",
            "@nhonh/driver-extension/*",
            "@nhonh/plugins-builtin",
            "@nhonh/plugins-builtin/*",
            "playwright",
            "playwright-core",
            "puppeteer-core",
          ],
          message:
            "Layering violation: viewer must consume only the Report JSON shape from @nhonh/core/types. No drivers, no plugins, no Playwright.",
        },
        {
          group: ["@nhonh/core/runtime", "@nhonh/core/runtime/*"],
          message:
            "Layering violation: viewer must not import the engine runtime — only the Report types.",
        },
      ],
    },
  ],
};

const cliRestriction = {
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        {
          group: ["playwright", "playwright-core", "puppeteer-core"],
          message:
            "Layering violation: CLI must use @nhonh/driver-* adapter factories, never reach Playwright directly.",
        },
        {
          group: [
            "@nhonh/driver-playwright/cdp-compat",
            "@nhonh/driver-playwright/oopif-attach",
            "@nhonh/driver-extension/cdp-compat",
          ],
          message:
            "Layering violation: CLI may use the driver's createPlaywrightAdapter() but must not reach into driver internals.",
        },
      ],
    },
  ],
};

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.turbo/**",
      "openspec/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    plugins: { import: importPlugin },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2023,
      sourceType: "module",
    },
    rules: {
      "import/no-cycle": ["error", { maxDepth: 5 }],
      "import/no-self-import": "error",
      "import/no-useless-path-segments": "error",
    },
  },
  {
    files: ["packages/plugins-builtin/**/*.{ts,tsx}"],
    rules: layeringRules,
  },
  {
    files: ["packages/reporter-*/**/*.{ts,tsx}"],
    rules: layeringRules,
  },
  {
    files: ["packages/viewer/**/*.{ts,tsx}", "apps/website/**/*.{ts,tsx}"],
    rules: viewerRestriction,
  },
  {
    files: ["apps/cli/**/*.{ts,tsx}"],
    rules: cliRestriction,
  },
];
