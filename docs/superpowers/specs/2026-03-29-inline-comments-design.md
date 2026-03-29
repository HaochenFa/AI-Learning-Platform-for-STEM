# Inline Code Documentation — Design Spec

**Date:** 2026-03-29
**Status:** Approved
**Scope:** 15 high-priority files across TypeScript lib/, app/, and Python backend/

---

## Background

Current comment density is ~0–1% across all TypeScript files and ~1–2% in Python (almost entirely docstrings and the `analytics.py` step-headers). Complex logic — DAG cycle detection, 7-state provisioning machines, scoring heuristics with magic weights, LangGraph fallback orchestration — is entirely uncommented. This spec defines how to add documentation uniformly across the three layers.

---

## Comment Standards

All three comment types (A, B, C) are applied to every file.

### TypeScript

**C — JSDoc on every exported function and type:**
```ts
/**
 * Selects the best chunks from indexed materials within a token budget.
 *
 * Applies a per-material cap (`DEFAULT_MAX_PER_MATERIAL`) before greedy
 * selection so no single material dominates the context window.
 *
 * @param chunks   Ranked embeddings from the vector index
 * @param budget   Max tokens to fill (caller-controlled)
 * @returns        Selected chunks in relevance order, total token count
 */
```

**B — Section headers inside long function bodies:**
```ts
// --- Validate attempt limits ---
// --- Build scoring payload ---
// --- Persist and return ---
```

**A — Inline "why" on non-obvious lines:**
```ts
// Offset by 1 ms so assistant message always sorts after user message
// when queries order by created_at (same-tick inserts are ambiguous).
assistantTimestamp = new Date(userTimestamp.getTime() + 1);
```

### Python

**C — Google-style docstrings on every function and class:**
```python
def resolve_thread_id(class_id: str, user_id: str) -> str:
    """Deterministically derive a LangGraph thread ID from class + user.

    Uses SHA-256 truncated to 16 hex chars so the ID is stable across
    restarts and avoids exposing raw UUIDs in checkpointer storage.

    Args:
        class_id: UUID of the class the student is enrolled in.
        user_id:  Supabase auth UID of the current user.

    Returns:
        A 16-character hex string unique to the (class, user) pair.
    """
```

**B — Numbered section headers (extending `analytics.py`'s existing pattern):**
```python
# --- 1. Guard: check generating flag (CAS) ---
# --- 2. Load blueprint context ---
```

**A — Inline why-comments:**
```python
# trust_env=False: prevents httpx picking up proxy env vars in
# production, which causes silent connection failures. See CLAUDE.md.
client = httpx.Client(trust_env=False)
```

---

## File Groupings

### Layer 1 — `chore/comments-lib` → PR: Core Libraries
*Branch forks from `main`. 10 files, ~2,400 LOC.*

| File | Key logic requiring documentation |
|---|---|
| `web/src/lib/guest/sandbox.ts` | 7-state provisioning state machine, `shouldSignOutOnFailure` flag, `clone_guest_sandbox` RPC fallback, `discardGuestSandbox` storage cleanup chain |
| `web/src/lib/chat/compaction.ts` | 6 scoring weights (magic numbers 0.8, 1.5, 1.3, 1.1, 0.7, cap 18), incremental term-frequency merge, `selectChronologicalHighlights` sort-then-re-sort, dual trigger (token-pressure vs message-count) |
| `web/src/lib/chat/context.ts` | Two-path blueprint loading (canonical `content_json` vs legacy topic+objective rows fallback), `buildChatPrompt` ground-truth system prompt construction, `canvas_hint` extension point |
| `web/src/lib/ai/blueprint.ts` | DAG cycle detection via DFS (visiting/visited sets), `hasCycle` recursion, `extractJsonWithFallback` two-pass strategy, `repairJson` curly-quote replacement, contiguous sequence validation, near-duplicate title normalisation |
| `web/src/lib/ai/python-backend.ts` | `fetchWithTimeout` abort controller with `didTimeout` flag, `TeachingBriefPayload` normalisation incl. `normalizeAttentionItem` struct-vs-string polymorphism, snake_case↔camelCase mapping |
| `web/src/lib/auth/session.ts` | `getAuthContext` anonymous-user detection heuristic, inline guest sandbox expiry+signOut side-effect, `requireGuestOrVerifiedUser` fallback chain |
| `web/src/lib/materials/chunking.ts` | `countOverlapWords` backward scan with cumulative char count, long-word escape hatch, `safeOverlap = min(overlapWords, maxOverlap)` guard |
| `web/src/lib/materials/retrieval.ts` | Per-material usage cap (`DEFAULT_MAX_PER_MATERIAL`), greedy token-budget selection with early `break`, `buildContext` source-header labelling format |
| `web/src/lib/materials/extract-text.ts` | `pagerender` callback overrides pdf-parse default, de-hyphenation regex `-\n(?=\w)`, JSZip slide ordering, XML tag regex with `[\s\S]*?` lazy match |
| `web/src/lib/activities/assignments.ts` | `createWholeClassAssignment` manual rollback closure, transactional semantics (assignment insert → recipient insert, rollback on failure) |

### Layer 2 — `chore/comments-app` → PR: Server Actions
*Branch forks from `main`. 3 files, ~1,300 LOC.*

| File | Key logic requiring documentation |
|---|---|
| `web/src/app/actions.ts` | `buildResendStateParams` dual `verify`/`sent` field encoding, `isEmailAlreadyRegisteredError` multi-code union, guest→real-account discard+sign-out before creation |
| `web/src/app/classes/[classId]/quiz/actions.ts` | Attempt-limit enforcement, code-23505 duplicate-submission race condition, `trimStaleQuestions` delete-by-order_index, `savingPolicy`/`revealPolicy` hardcoded config, `bestScore` computation |
| `web/src/app/classes/[classId]/chat/actions.ts` | `submitChatAssignment` upsert-vs-insert logic, `reviewChatSubmission` permission checks, `sendAssignmentMessage` transcript parsing |

### Layer 3 — `chore/comments-backend` → PR: Python Backend
*Branch forks from `main`. 3 files, ~2,800 LOC.*

| File | Key logic requiring documentation |
|---|---|
| `backend/app/chat.py` | LangGraph vs `direct_v1` fallback orchestration, `_LANGGRAPH_CHECKPOINTER`/`_LANGGRAPH_STORE` module-level singletons, `resolve_thread_id` deterministic hash composition, `extract_json_object_candidates` hand-rolled FSM, dual `usage_metadata`/`response_metadata` normalisation |
| `backend/app/analytics.py` | `_mark_teaching_brief_generating` compare-and-set race-condition guard, `is_stale`/`force_refresh`/`generating` state machine in `get_class_teaching_brief`, Bloom cross-join scoring, best-score denominator semantics, `INSIGHTS_CACHE_TTL_SECONDS` vs `_is_same_utc_day` dual freshness strategies |
| `backend/app/providers.py` | Deadline-based timeout with `_remaining_timeout_ms`, provider priority override algorithm in `_resolve_provider_order`, `_normalize_chat_content` list-of-blocks handling, Gemini API shape differences (`batchEmbedContents`, `candidatesTokenCount`) |

---

## Subagent Dispatch Strategy

- **Parallelism:** Three `general-purpose` subagents launched simultaneously, each in an isolated git worktree (`isolation: "worktree"`).
- **Each subagent:** reads all files in its layer fully before writing any comments, applies A+B+C standards, commits, pushes to both `origin` and `org`, and opens a PR targeting `main`.

### Commit messages
```
chore(comments): add inline documentation to lib/ core modules
chore(comments): add inline documentation to app/ server actions
chore(comments): add inline documentation to backend/ Python service
```

### PR conventions
- Title: `chore: add inline comments to <layer> layer`
- Body: bullet list of files changed + what was documented
- Base branch: `main`
- No reviewers assigned (documentation-only)

---

## Guard Rails

- **No logic changes.** Comments only. If a comment reveals a latent bug, note it in the PR body but do not fix it.
- **No self-evident comments.** `const x = 1` needs no comment.
- **Preserve existing comments.** The sparse existing ones (e.g. the 23505 race note in quiz/actions.ts, the guest→real-account comment in actions.ts) stay as-is and can be expanded if needed.

---

## Out of Scope

- Test files (`*.test.ts`, `backend/tests/`)
- Simple UI components with no non-trivial logic
- Configuration files
- Migration SQL files
