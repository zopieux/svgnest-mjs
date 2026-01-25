import unusedImports from "eslint-plugin-unused-imports";
import js from "@eslint/js";

export default [
  {
    ignores: ["src/util/clipper.js", "dist/**"]
  },
  js.configs.recommended,
  {
    files: ["src/**/*.js", "tools/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        window: "readonly",
        self: "readonly",
        document: "readonly",
        navigator: "readonly",
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        FileReader: "readonly",
        URL: "readonly",
        Blob: "readonly",
        Worker: "readonly",
        ClipperLib: "readonly",
        GeometryUtil: "readonly",
        SvgParser: "readonly",
        PlacementWorker: "readonly",
        GeneticAlgorithm: "readonly",
        Matrix: "readonly",
        GA: "readonly",
        binPolygon: "readonly",
        tree: "readonly",
        config: "readonly",
        progress: "readonly",
        GAInstance: "readonly",
        __dirname: "readonly",
        DOMParser: "readonly",
        alert: "readonly"
      }
    },
    plugins: {
      "unused-imports": unusedImports
    },
    rules: {
      "no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        { "vars": "all", "varsIgnorePattern": "^_", "args": "after-used", "argsIgnorePattern": "^_" }
      ],
      "no-undef": "warn",
      "no-redeclare": "off",
      "no-fallthrough": "off",
      "no-case-declarations": "off",
      "no-cond-assign": "off",
      "no-empty": "off",
      "no-unsafe-negation": "off",
      "no-useless-escape": "warn"
    }
  }
];