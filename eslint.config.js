import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import globals from "globals";

export default [
    {
        ignores: [
            "dist/**",
            ".solver-ssr/**",
            "dumped_game_scripts/**",
            ".variants/**",
            "venv/**",
            ".venv/**",
        ],
    },
    js.configs.recommended,
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
            "react/jsx-uses-react": "error",
            "react/jsx-uses-vars": "error",
            "react/prop-types": "off",

            "react-hooks/rules-of-hooks": "error",
            "react-hooks/exhaustive-deps": "warn",

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
            "react/jsx-uses-react": "error",
            "react/jsx-uses-vars": "error",
            "react/prop-types": "off",

            "react-hooks/rules-of-hooks": "error",
            "react-hooks/exhaustive-deps": "warn",

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
