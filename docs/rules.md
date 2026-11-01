# AI Coding Agent Rules (`rule.md`)

## 1. File Size & Modularity (Hard Cap: 200 Lines)

- **Max 200 lines per file:** If a file approaches 200 lines, split it into
  smaller, single-responsibility modules (e.g., separate DOM scraping, state
  management, and UI rendering).
- **One concern per file:** A file should do one thing well (e.g.,
  `useWakeLock.ts` only manages Wake Lock; `canaryCheck.ts` only validates
  selectors).
- **Flat over nested:** Keep folder structures shallow and predictable.

## 2. Surgical & Focused Edits Only

- **Touch only what is requested:** Do not refactor, reformat, rename variables,
  or alter UI/UX styles in unrelated parts of the codebase.
- **Preserve working logic:** Never rewrite an entire file if a 10-line targeted
  edit solves the problem.
- **Ask before architectural changes:** If a task requires changing the folder
  structure, build config, or state flow, state why and ask first.

## 3. DRY & Single Source of Truth

- **Search before writing:** Before creating a helper, hook, or utility, check
  if one already exists in the codebase.
- **Shared types live in one place:** Never duplicate TypeScript interfaces or
  JSON schemas across packages. Import all shared contracts from
  `packages/shared-types/schema.ts`.
- **Extract on the 2nd repetition:** If the same logic (e.g., URL validation,
  message dispatching, CSS hash stripping) appears twice, extract it into a
  shared utility immediately.

## 4. Strict TypeScript & Zero Placeholders

- **No `any` types:** Use strict types, discriminated unions, or `unknown` with
  type guards.
- **No lazy placeholders:** Never leave `// TODO`,
  `// ... rest of implementation`, or mocked stub data unless explicitly asked.
  Write complete, working code.
- **Delete dead code:** Do not leave commented-out code blocks or unused imports
  behind. Move fast, keep the tree clean.

## 5. Dependency & Environment Discipline

- **No unapproved packages:** Do not install new npm packages if native
  browser/Web APIs or existing dependencies can do the job cleanly.
- **No hardcoded secrets or URLs:** Always read API keys, Supabase URLs, and
  model endpoints (Jev/Laya) from environment variables with a single config
  entry point.

## 6. Defensive Lifecycle & Error Handling

- **No silent `catch {}` blocks:** Every `try/catch` must either recover
  gracefully (e.g., Tier 1 cache miss falling back to Tier 2) or log a
  structured error with context (`[Vibe:Module] Error message`).
- **Always clean up side effects:** Every `MutationObserver`, `setInterval`,
  `addEventListener`, Wake Lock, or WebSocket subscription must have a
  deterministic cleanup/disconnect path to prevent memory leaks.
