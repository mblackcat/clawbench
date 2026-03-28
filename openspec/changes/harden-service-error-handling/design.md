## Context

The three main-process services (`python-runner`, `publisher`, `auth`) already have `logger` imported and use structured error patterns elsewhere in their code. These fixes align with existing conventions rather than introducing new patterns.

## Goals / Non-Goals

**Goals:**
- Make debugging sub-app output issues possible (currently invisible)
- Prevent publish crashes on malformed manifests
- Fail fast with clear messages when Feishu API responses are malformed

**Non-Goals:**
- Retry logic or recovery strategies (out of scope)
- Changing the JSON-line protocol or sub-app contract
- Adding schema validation for manifest.json (a separate concern)

## Decisions

### Decision 1: Use `logger.warn` for non-fatal JSON parse in python-runner

The parse failure is non-fatal (the line is still forwarded as plain text), so `warn` is the right level -- not `error`. Include both the raw line and the error message so developers can diagnose the sub-app.

### Decision 2: Wrap `JSON.parse` inline in publisher rather than extracting a helper

The publisher already has a pattern of early-return with `{ success: false, error: "..." }` (see lines 128-134). A local try-catch that follows this same pattern is simpler and more consistent than introducing a utility function.

### Decision 3: Validate token fields with a guard block before casting

Rather than replacing `as` casts with runtime type-narrowing generics or a validation library, a simple `if (!field)` check before each cast site is minimal and readable. Throw on the login path (already inside a try-catch that handles errors), return `false` on the refresh path (matching existing failure pattern on line 283).
