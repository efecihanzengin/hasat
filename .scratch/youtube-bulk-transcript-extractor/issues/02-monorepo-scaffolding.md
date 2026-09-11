# 02: Monorepo Scaffolding, Build & Verification Harness

**What to build:**
A pnpm workspaces monorepo structure containing `packages/core` (pure TS library) and `apps/extension` (MV3 Vite/CRXJS React application), configured with strict TypeScript, Vitest, ESLint, and Prettier so that verification pipelines run cleanly across all packages.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## Acceptance Criteria

- [x] `pnpm-workspace.yaml` configured with `packages/*` and `apps/*`.
- [x] Root `package.json` with scripts for `typecheck`, `lint`, `test`, and `build`.
- [x] TypeScript strict mode enabled across all packages (`noImplicitAny`, strict null checks, no `@ts-ignore` allowances).
- [x] `packages/core` initialized as pure TS library (no DOM, no `chrome.*`, no network dependencies).
- [x] `apps/extension` initialized with Vite and CRXJS for MV3 extension building.
- [x] Vitest test runner configured and runnable with zero external network access.
- [x] `pnpm typecheck && pnpm lint && pnpm test` runs cleanly.
