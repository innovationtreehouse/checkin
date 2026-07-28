# Agent Instructions & Guidelines

> **Start with [AGENTS.md](AGENTS.md)** — the shared, canonical orientation for
> all agents in this repo (repo layout, test classes, docs map, and the
> commenting strategy). The rules below are Gemini-specific additions on top of
> it. Keep the two cross-consistent.

## Code Quality & Linting
- **NEVER fix lint errors by disabling the linter.** Do not use `// eslint-disable-next-line`, `/* eslint-disable */`, `@ts-expect-error`, or `@ts-ignore` to suppress errors.
- **NEVER fix TypeScript errors by using `any` coercions.** Always properly type variables, parameters, and return signatures. If a type isn't immediately obvious, define an interface or use `unknown` and perform proper type narrowing.
- Address the root cause of the lint or type error by modifying the logic, defining missing types, or importing the correct interfaces.
