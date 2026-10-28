---
type: constitution
title: vende-facil-app — Constitution
description: The non-negotiable principles every rsc-sdd phase obeys.
tags: [sdd, constitution]
timestamp: 2026-10-27T20:19:58-06:00
topic: sdd
version: v1.1.0
---

# vende-facil-app — Constitution

> Version: v1.1.0 · Ratified: 2026-10-27 · Last amended: 2026-10-27
> The non-negotiable principles every rsc-sdd phase obeys. Stack mechanics live in the
> repo manifests; this file ratifies the principle and links the detail.

## 1. Stack canon

1. Runtime and packaging are fixed: Node.js 24, TypeScript 5.9 in `strict` mode, pnpm 12
   with the single committed `pnpm-lock.yaml`. Changing the package manager is a MINOR
   amendment; one lockfile stays committed.
2. Frameworks are fixed: Next.js 16 App Router, React 19, Tailwind CSS 4, Zod 4. Replacing
   one is a MAJOR amendment.
3. Supabase (PostgreSQL 17) is the only persistence. Schema changes land as a new,
   sequentially numbered migration in `supabase/migrations/`; applied migrations 001+ are
   never edited or renumbered. Detail: `MEMORY.md` (T-004 schema history).

## 2. Quality bar

4. `pnpm lint` and `pnpm typecheck` pass with zero errors and zero warnings before merge.
   `strict: true` in `tsconfig.json` is never relaxed.
5. `pnpm test` passes with 0 failures and 0 skipped tests before merge. Every new behavior
   ships with its own test (unit or integration, whichever observes it); no numeric coverage
   floor is claimed until coverage is actually configured.
6. `pnpm build` succeeds before merge. A change that breaks the production build cannot ship.
7. Tests are deterministic: no retries, sleeps or calendar alignment may be required to make
   a suite green. A flaky test is a defect to fix, not to skip.

## 3. Conventions

8. Layers are fixed: Presentation (`src/app`, `src/components`), API (route handlers),
   Application (`src/features`, `src/lib`), Infrastructure (Supabase, AI providers,
   `src/types` as contracts). New code respects the boundaries; cross-layer imports are a
   review finding.
9. Public contracts are frozen: `IDescriptionRequest`, `IDescriptionResponse` and their Zod
   schema do not change — including field renames, removals or semantic shifts — without an
   explicit user approval and a spec amendment in `specs/`.
10. Commit messages use Conventional Commits in Spanish (`feat:`, `fix:`, `test:`, `docs:`,
    `refactor:`, `chore:`), with no gitmoji.
11. User-facing copy and messages are written in Spanish (Mexico).

## 4. Branching & shipping

12. Work happens on a branch and lands via pull request; the default branch is closed to
    direct agent work. The agent never pushes, commits or opens a PR without an explicit
    user request.
13. One task at a time, with prior approval. Functionality not present in an approved spec is
    not implemented.
14. **Git authorship is the human's.** No `Co-Authored-By` an AI and no "generated with"
    footer. Enforced at the `ship` phase.

## 5. Security & privacy floor

15. No secret is ever committed. Secrets load from server-side environment variables declared
    in `.env.example` (or `01-TOOLS/<provider>/.env`, gitignored); `NEXT_PUBLIC_` is never used
    for keys or for the AI authorization switch.
16. Real AI calls are off by default and require both `AI_ENABLED=true` and
    `AI_REAL_CALLS_ENABLED=true`, an enabled provider with a key, and the quota, budget and
    security controls in place.
17. Quota, budget, rate-limit and abuse controls are never removed, weakened or bypassed
    without explicit approval. They are independent of each other.
18. Fail-closed: when quota, budget, rate limit or provider state cannot be verified, the
    generation is denied instead of served.
19. Database least privilege: RLS stays enabled where it exists, `EXECUTE` stays restricted to
    `service_role`, and `SECURITY DEFINER` is not introduced without approval. Each migration
    ships its own grants and revokes.
20. Public responses never expose provider internals, upstream errors or internal identifiers.
21. Identification is anonymous (server-generated `visitor_id` cookie, HttpOnly). No invasive
    fingerprinting; no mandatory sign-up for the MVP.

## 6. UX / accessibility floor

22. Every interface decision is mobile-first and responsive. Minimum accessibility bar:
    WCAG 2.1 AA — keyboard navigable, visible focus, sufficient contrast, labeled controls.

## 7. Performance budgets

23. LCP ≤ 2.5 s on a mobile 4G profile for the main view, and API p95 latency ≤ 1 s excluding
    AI provider time. The 25 s global AI timeout (`AI_GLOBAL_TIMEOUT_MS`) is preserved.

## 8. Knowledge & decisions

24. Every significant decision is appended to `02-DOCS/wiki/sdd/decisions.md` with date,
    options considered and why. `MEMORY.md` remains the operational state log.
25. Approved specs in `specs/` are binding. A contradiction between code, spec and this
    constitution is surfaced to the user, never resolved silently.
26. No layer, abstraction, indirection or dependency is added without a second concrete
    consumer in the same change or an approved spec. A single-use wrapper is a review finding;
    a dependency is approved explicitly first.

## Definition of Done (the merge bar `verify` runs against)

A change ships only when ALL hold:

- [ ] `pnpm lint` and `pnpm typecheck` clean (principle 4).
- [ ] `pnpm test` green, 0 skipped, and the new behavior has its own test (principles 5, 7).
- [ ] `pnpm build` succeeds (principle 6).
- [ ] Layer boundaries and frozen contracts respected (principles 8-9).
- [ ] Conventional Commit in Spanish; committed only on explicit request (principles 10, 12).
- [ ] On a branch, merged via PR, authored by the human (principles 12-14).
- [ ] No secret committed; AI switches and abuse controls intact (principles 15-19).
- [ ] No provider internals leaked in public responses (principle 20).
- [ ] WCAG 2.1 AA and the performance budgets met where the change touches UI or API
      (principles 22-23).
- [ ] Significant decisions logged (principle 24).

## Amendment log (append-only)

| Date | Version | Change | Why |
|------|---------|--------|-----|
| 2026-10-27 | draft | Draft generated by `rsc onboard`. | The SDD floor needs a constitution; ratification is the `constitution` phase's. |
| 2026-10-27 | v1.0.0 | Ratified initial constitution (25 principles), consolidating the 14 root rules, the rsc fixed principles, and the ratified bars: suite-green testing, WCAG 2.1 AA, LCP ≤ 2.5 s / p95 ≤ 1 s, Conventional Commits, SDD constitution as source of truth. | Project kickoff of the harness; asynchronous SDD work needs one enforceable bar. |
| 2026-10-27 | v1.1.0 | Added principle 26 (no abstraction, layer or dependency without a second concrete consumer or an approved spec). | Root rule 5 ("evitar sobreingeniería") was lost in the v1.0.0 consolidation; this restores it as a checkable rule. |
