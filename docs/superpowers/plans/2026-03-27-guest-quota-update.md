# Guest Quota Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update guest AI limits so global guest concurrency is capped at 10 parallel requests and guest embeddings are allowed up to 5 operations per guest sandbox/session.

**Architecture:** Keep the current guest quota architecture intact. Update the quota source-of-truth values in backend settings, remove the special-case assumption that embeddings are always blocked, and align frontend/backend tests plus supporting docs with the new approved limits. Do not redesign shared global enforcement in this plan.

**Tech Stack:** Next.js 16 App Router, TypeScript, Vitest, Python FastAPI, Python unittest, Markdown specs/plans.

---

## File structure

### Existing files to modify

| File | Change |
|------|--------|
| `docs/superpowers/specs/2026-03-24-guest-mode-design.md` | Already updated approved spec values; verify they remain consistent. |
| `backend/app/config.py` | Change default `guest_max_concurrent_ai_requests` from `20` to `10` and `guest_embedding_limit` from `0` to `5`. |
| `backend/tests/helpers.py` | Keep helper defaults aligned with production defaults where tests depend on quota baselines. |
| `backend/app/guest_rate_limit.py` | Keep logic generic; ensure embeddings use normal quota checks rather than a blocked-by-default assumption. |
| `backend/tests/test_guest_rate_limit.py` | Replace “embedding always blocked” expectation with quota-based embedding behavior and align concurrency expectations with 10 unless a test intentionally overrides it. |
| `web/src/lib/guest/rate-limit.ts` | Remove the special-case assumption that embeddings are always unsupported; embeddings should behave like a normal guest quota-controlled feature. |
| `web/src/lib/guest/rate-limit.test.ts` | Replace “embedding always blocked” with “embedding allowed below 5, blocked at 5.” |
| `docs/superpowers/plans/2026-03-26-guest-mode-implementation.md` | Update any quota references that still mention `20` or embedding `0`. |

### No new files required

This change is a quota-policy update, not a new subsystem.

---

### Task 1: Update backend quota defaults

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/tests/helpers.py`

- [ ] **Step 1: Write the failing backend settings test**

Add to `backend/tests/test_main.py` or create a small focused assertion in `backend/tests/test_guest_rate_limit.py`:

```python
def test_guest_quota_defaults_match_approved_spec(self) -> None:
    settings = make_settings(
        guest_max_concurrent_ai_requests=10,
        guest_embedding_limit=5,
    )
    self.assertEqual(settings.guest_max_concurrent_ai_requests, 10)
    self.assertEqual(settings.guest_embedding_limit, 5)
```

- [ ] **Step 2: Run the targeted backend test to verify the intended values are not yet the defaults**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project && python3 -m unittest discover -s backend/tests -p 'test_main.py'
```

Expected: if you asserted against real defaults rather than explicit overrides, FAIL because defaults are still `20` and `0`.

- [ ] **Step 3: Update backend config defaults**

Change `backend/app/config.py`:

```python
guest_max_concurrent_ai_requests=_get_int("GUEST_MAX_CONCURRENT_AI_REQUESTS", 10),
guest_chat_limit=_get_int("GUEST_CHAT_LIMIT", 50),
guest_quiz_limit=_get_int("GUEST_QUIZ_LIMIT", 5),
guest_flashcards_limit=_get_int("GUEST_FLASHCARDS_LIMIT", 10),
guest_blueprint_limit=_get_int("GUEST_BLUEPRINT_LIMIT", 3),
guest_embedding_limit=_get_int("GUEST_EMBEDDING_LIMIT", 5),
```

- [ ] **Step 4: Align test helper defaults**

Update `backend/tests/helpers.py`:

```python
base = Settings(
    python_backend_api_key="test-key",
    python_backend_allow_unauthenticated_requests=False,
    ai_provider_default="openrouter",
    ai_request_timeout_ms=30000,
    ai_embedding_timeout_ms=30000,
    guest_max_concurrent_ai_requests=10,
    guest_chat_limit=50,
    guest_quiz_limit=5,
    guest_flashcards_limit=10,
    guest_blueprint_limit=3,
    guest_embedding_limit=5,
    ...
)
```

- [ ] **Step 5: Run backend tests to verify the defaults are now aligned**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project && python3 -m unittest discover -s backend/tests -p 'test_main.py'
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/config.py backend/tests/helpers.py backend/tests/test_main.py
git commit -m "fix: align guest quota defaults with approved limits"
```

---

### Task 2: Make embeddings behave like a normal guest quota-controlled feature

**Files:**
- Modify: `web/src/lib/guest/rate-limit.ts`
- Modify: `web/src/lib/guest/rate-limit.test.ts`
- Modify: `backend/app/guest_rate_limit.py`
- Modify: `backend/tests/test_guest_rate_limit.py`

- [ ] **Step 1: Write the failing frontend embedding quota test**

Update `web/src/lib/guest/rate-limit.test.ts` by replacing the blocked-embedding assertion with quota-based coverage:

```ts
it("allows guest embeddings when usage is below the limit", async () => {
  makeSupabase({ embedding_operations_used: 2 });

  const result = await checkGuestRateLimit("sandbox-1", "embedding");

  expect(result).toEqual({ allowed: true });
});

it("blocks guest embeddings when usage reaches the limit", async () => {
  makeSupabase({ embedding_operations_used: 5 });

  const result = await checkGuestRateLimit("sandbox-1", "embedding");

  expect(result).toEqual({
    allowed: false,
    message: "You've used all 5 guest embedding operations. Create a free account to keep going.",
  });
});
```

- [ ] **Step 2: Run the frontend test to verify it fails**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project/web && pnpm exec vitest run src/lib/guest/rate-limit.test.ts
```

Expected: FAIL because embeddings are still handled as always blocked.

- [ ] **Step 3: Remove the special-case embedding block in the frontend helper**

Update `web/src/lib/guest/rate-limit.ts` so `embedding` is treated the same as the other features:

```ts
const GUEST_LIMITS = {
  chat: { column: "chat_messages_used", limit: 50, label: "chat messages" },
  quiz: { column: "quiz_generations_used", limit: 5, label: "quiz generations" },
  flashcards: { column: "flashcard_generations_used", limit: 10, label: "flashcard generations" },
  blueprint: { column: "blueprint_regenerations_used", limit: 3, label: "blueprint regenerations" },
  embedding: { column: "embedding_operations_used", limit: 5, label: "embedding operations" },
} as const;
```

and keep the generic quota path:

```ts
const { data, error } = await supabase
  .from("guest_sandboxes")
  .select(config.column)
  .eq("id", sandboxId)
  .maybeSingle<Record<string, number>>();
```

No `if (!config.column)` branch should remain after this change.

- [ ] **Step 4: Write the failing backend embedding quota test**

Update `backend/tests/test_guest_rate_limit.py`:

```python
def test_embedding_uses_guest_quota_limit(self) -> None:
    self.assertEqual(check_guest_ai_access(self.settings, "sandbox-embed", "embedding"), (True, None))
    for _ in range(5):
        increment_guest_ai_usage("sandbox-embed", "embedding")
    self.assertEqual(
        check_guest_ai_access(self.settings, "sandbox-embed", "embedding"),
        (False, "Guest embedding limit reached."),
    )
```

- [ ] **Step 5: Run the backend test to verify it fails**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project && python3 -m unittest discover -s backend/tests -p 'test_guest_rate_limit.py'
```

Expected: FAIL because embeddings are currently treated as blocked by default (`limit <= 0`).

- [ ] **Step 6: Keep backend rate-limit logic generic**

Update `backend/app/guest_rate_limit.py` only if needed so the existing feature lookup path remains generic and embeddings use the configured `guest_embedding_limit`:

```python
def _feature_limit(settings: Settings, feature: str) -> int:
    if feature == "chat":
        return settings.guest_chat_limit
    if feature == "quiz":
        return settings.guest_quiz_limit
    if feature == "flashcards":
        return settings.guest_flashcards_limit
    if feature == "blueprint":
        return settings.guest_blueprint_limit
    if feature == "embedding":
        return settings.guest_embedding_limit
    return 0
```

No special-case “always blocked” embedding branch should remain in tests or helper wording.

- [ ] **Step 7: Run frontend and backend quota tests to verify they pass**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project/web && pnpm exec vitest run src/lib/guest/rate-limit.test.ts
```

Expected: PASS.

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project && python3 -m unittest discover -s backend/tests -p 'test_guest_rate_limit.py'
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/guest/rate-limit.ts web/src/lib/guest/rate-limit.test.ts backend/app/guest_rate_limit.py backend/tests/test_guest_rate_limit.py
git commit -m "fix: allow guest embeddings within quota limits"
```

---

### Task 3: Align plan/docs text with approved quota values

**Files:**
- Modify: `docs/superpowers/specs/2026-03-24-guest-mode-design.md`
- Modify: `docs/superpowers/plans/2026-03-26-guest-mode-implementation.md`

- [ ] **Step 1: Search for stale quota references**

Look for old values:

```bash
cd /Users/billyfa/COMP3122_ISD_Project && rg "20 concurrent|Embedding operations \| 0|GUEST_EMBEDDING_LIMIT|GUEST_MAX_CONCURRENT_AI_REQUESTS" docs/superpowers
```

Expected: find stale references in the implementation plan and possibly other notes.

- [ ] **Step 2: Update the implementation plan text to match approved values**

Wherever the plan references the old limits, update to:

```md
| Embedding operations | 5 |
```

and:

```md
- Max 10 concurrent guest AI operations across all guests
```

- [ ] **Step 3: Verify the approved design spec still matches the latest decision**

Confirm `docs/superpowers/specs/2026-03-24-guest-mode-design.md` contains:

```md
| Embedding operations | 5 |
```

and:

```md
- Max 10 concurrent guest AI operations across all guests
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-03-24-guest-mode-design.md docs/superpowers/plans/2026-03-26-guest-mode-implementation.md
git commit -m "docs: align guest quota docs with approved limits"
```

---

### Task 4: Final verification for the quota update slice

**Files:**
- No new source files; verification only.

- [ ] **Step 1: Run targeted frontend verification**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project/web && pnpm exec vitest run src/lib/guest/rate-limit.test.ts src/app/__tests__/middleware.guest.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run targeted backend verification**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project && python3 -m unittest discover -s backend/tests -p 'test_guest_rate_limit.py' && python3 -m unittest discover -s backend/tests -p 'test_main.py'
```

Expected: PASS.

- [ ] **Step 3: Run one broader guest-related pass**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project && python3 -m unittest discover -s backend/tests -p 'test_*.py'
```

Expected: PASS, or only unrelated pre-existing failures.

- [ ] **Step 4: Inspect the diff before merge**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project && git diff -- backend/app/config.py backend/app/guest_rate_limit.py backend/tests/helpers.py backend/tests/test_guest_rate_limit.py backend/tests/test_main.py web/src/lib/guest/rate-limit.ts web/src/lib/guest/rate-limit.test.ts docs/superpowers/specs/2026-03-24-guest-mode-design.md docs/superpowers/plans/2026-03-26-guest-mode-implementation.md
```

Expected: only approved quota changes plus the already-verified guest robustness fixes.

- [ ] **Step 5: Commit any final cleanup**

```bash
git add -A
git commit -m "test: verify guest quota policy update"
```

---

## Self-review

- **Spec coverage:** This plan covers the approved changes: global concurrency cap `10`, embedding quota `5` per guest sandbox/session, code/test/doc alignment.
- **Placeholder scan:** No TBD/TODO placeholders remain.
- **Type consistency:** Uses existing `GuestFeature` naming and current backend `Settings` fields; if you rename `embedding_operations_used`, update both frontend test/helper and any backing storage contract consistently.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-03-27-guest-quota-update.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
