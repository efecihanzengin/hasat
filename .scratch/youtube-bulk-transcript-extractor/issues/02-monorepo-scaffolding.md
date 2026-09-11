# 02: Monorepo Scaffolding, Build & Verification Harness

**What to build:**
A pnpm workspaces monorepo structure containing `packages/core` (pure TS library) and `apps/extension` (MV3 Vite/CRXJS React application), configured with strict TypeScript, Vitest, ESLint, and Prettier so that verification pipelines run cleanly across all packages.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## Acceptance Criteria

- [ ] `pnpm-workspace.yaml` configured with `packages/*` and `apps/*`.
- [ ] Root `package.json` with scripts for `typecheck`, `lint`, `test`, and `build`.
- [ ] TypeScript strict mode enabled across all packages (`noImplicitAny`, strict null checks, no `@ts-ignore` allowances).
- [ ] `packages/core` initialized as pure TS library (no DOM, no `chrome.*`, no network dependencies).
- [ ] `apps/extension` initialized with Vite and CRXJS for MV3 extension building.
- [ ] Vitest test runner configured and runnable with zero external network access.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` runs cleanly.
