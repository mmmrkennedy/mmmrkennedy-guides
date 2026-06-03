import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import globals from "globals";

export default [
    {
        ignores: [
            "build/**",
            "dist/**",
            "react-solvers/dist/**",
            "src/react-solvers/dist/**",
            "old_solvers/**",
            "public/static/js/**",
            "**/*.bundle.js",
            "**/*.chunk.js",
            "**/*.min.js",
        ],
    },
    js.configs.recommended,
    // CommonJS files config (build scripts, config files)
    {
        files: ["**/*.cjs"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: {
                ...globals.node,
            },
        },
        rules: {
            "no-unused-vars": [
                "warn",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                },
            ],
            "no-console": "off",
            "prefer-const": "warn",
            "no-var": "error",
            eqeqeq: "warn",
            "no-debugger": "error",
        },
    },
    // JavaScript files config
    {
        files: ["**/*.{js,jsx}"],
        plugins: {
            react,
            "react-hooks": reactHooks,
        },
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
            globals: {
                ...globals.browser,
                process: "readonly",
                __dirname: "readonly",
                module: "readonly",
                require: "readonly",
            },
        },
        settings: {
            react: {
                version: "detect",
            },
        },
        rules: {
            // React Rules
            "react/jsx-uses-react": "error",
            "react/jsx-uses-vars": "error",
            "react/prop-types": "off",

            // React Hooks Rules
            "react-hooks/rules-of-hooks": "error",
            "react-hooks/exhaustive-deps": "warn",

            // General JavaScript Rules
            "no-unused-vars": [
                "warn",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                },
            ],
            "no-console": ["warn", { allow: ["warn", "error"] }],
            "prefer-const": "warn",
            "no-var": "error",
            eqeqeq: "warn",
            "no-debugger": "error",
        },
    },
    // TypeScript/TSX files config
    ...tseslint.configs.recommended.map((config) => ({
        ...config,
        files: ["**/*.{ts,tsx}"],
    })),
    {
        files: ["**/*.{ts,tsx}"],
        plugins: {
            react,
            "react-hooks": reactHooks,
        },
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
            globals: {
                ...globals.browser,
            },
        },
        settings: {
            react: {
                version: "detect",
            },
        },
        rules: {
            // React Rules
            "react/jsx-uses-react": "error",
            "react/jsx-uses-vars": "error",
            "react/prop-types": "off",

            // React Hooks Rules
            "react-hooks/rules-of-hooks": "error",
            "react-hooks/exhaustive-deps": "warn",

            // TypeScript-specific rules
            "@typescript-eslint/no-unused-vars": [
                "warn",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                },
            ],
            "@typescript-eslint/no-explicit-any": "warn",
            "no-console": ["warn", { allow: ["warn", "error"] }],
            "prefer-const": "warn",
            "no-var": "error",
            eqeqeq: "warn",
            "no-debugger": "error",
        },
    },
    // scripts.js exposes globals for HTML onclick handlers in .njk templates — ESLint can't see cross-file usage
    {
        files: ["src/js/scripts.js"],
        rules: {
            "no-unused-vars": "off",
        },
    },
    // Build/CLI scripts run in Node and legitimately log progress to stdout.
    {
        files: ["build_scripts/**"],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
        rules: {
            "no-console": "off",
        },
    },
];
