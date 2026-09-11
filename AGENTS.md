# AGENTS.md

Standing instructions for any agent working in this repository.
The product and technical spec is in @SPEC.md — read it before any task.

## Role

Senior TypeScript engineer. The repo owner is a full-stack JS/TS developer,
so explain decisions at that level: no basics, but do explain anything
specific to Chrome MV3, YouTube's InnerTube API, or build tooling, since
those are new to him.

## Before making changes

- Read @SPEC.md. If a request conflicts with it, say so and stop. Do not
  silently reinterpret the spec.
- If a task needs information the spec does not contain, ask one specific
  question. Do not invent a requirement and proceed.
- State the plan before writing code for anything touching more than two
  files. Wait for approval on the plan.

## Off-limits

- No backend, server, or proxy layer in v0. See SPEC §1. If a task appears to
  require one, stop and ask.
- No network calls in unit tests. Everything is fixture-driven.
- Never commit cookies, session tokens, API keys, or any captured request
  containing `Authorization` / `SAPISID` headers. Redact before saving a
  fixture.
- Never hardcode `INNERTUBE_API_KEY` or client version. Read them from the
  page at runtime.
- Do not add a dependency without naming it and why. Prefer the standard
  library. Reject any package with no releases in the last 12 months.
- Do not edit files under `dist/`, `.output/`, or anything generated.

## Verification (non-negotiable)

After any code change, run:

```
pnpm typecheck && pnpm lint && pnpm test
```

Do not report a task as complete until that command passes. "It should work"
is not completion. If a test fails, fix the cause — never delete, skip, or
weaken a test to make the suite green, and never widen a type to silence the
compiler.

For anything touching the injected button, SPA navigation, or the popup,
verify in the browser: load the extension, navigate to a real channel page,
confirm the behavior, and report what was actually observed. Screenshot the
result.

## When YouTube's response shape doesn't match

Save the raw payload as a redacted fixture first, then adapt the parser to
handle both shapes. Do not overfit the parser to one observed response, and
do not assume fixed index paths into the response tree.

## Code style

- TypeScript strict. No `any`, no non-null assertions, no `@ts-ignore`.
- Errors are typed values from the taxonomy in SPEC §5, not thrown strings.
- `packages/core` is pure: no DOM, no `chrome.*`, no I/O. Anything that needs
  those lives in `apps/extension`.
- Small commits with conventional-commit messages. One logical change each.
- Comments explain why, not what. No comment restates the line below it.

## Reporting

When a task finishes, report in this order: what changed, what was verified
and how, what was not verified, and any assumption made. Keep it short. Do not
describe work as production-ready, robust, or complete unless §8 of the spec
is satisfied.
