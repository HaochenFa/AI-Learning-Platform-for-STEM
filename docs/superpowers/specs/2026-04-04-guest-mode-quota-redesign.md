# Guest Mode Quota Redesign

**Date:** 2026-04-04  
**Status:** Approved  
**Scope:** `web/src/lib/guest/`, `backend/app/`, `supabase/migrations/`

---

## Context

The current guest mode uses per-IP entry rate limiting (5 new sessions/hour per IP) as its primary abuse guard. This causes two problems in a course-project context:

1. **Grader blocking** — professors and TAs sharing a college WiFi public IP exhaust the per-IP limit quickly, silently blocking evaluation of the platform.
2. **Overly restrictive feature quotas** — quiz (5), blueprint (3), and embedding (5) limits are too low for a meaningful demo within a session.
3. **No queuing on AI concurrency** — when the global concurrent AI slot limit is hit, requests are rejected immediately instead of waiting briefly.

The redesign retires per-IP tracking entirely, replaces it with fair global session caps, extends session TTLs, raises feature quotas, and adds proper async queuing for AI concurrency.

---

## Goals

- No IP-based blocking of any kind
- Fair global caps: max 60 active guest sessions, max 20 new sessions created per hour
- Generous session lifetime: 32h hard TTL, 8h inactivity timeout
- Raised per-session AI feature quotas
- AI concurrency limit raised to 20; requests queue (up to 60s) rather than fail immediately

---

## Non-Goals

- Persistent guest data across devices or after session expiry (TTL extension is sufficient)
- Horizontal backend scaling (single uvicorn process assumed; asyncio semaphore is sound)
- Redis or any new infrastructure dependency

---

## Architecture

### What is Retired

| Artifact | Location | Replacement |
|---|---|---|
| `guest_entry_rate_limits` table | DB migration | `guest_session_quota` table |
| `consume_guest_entry_rate_limit_service` RPC | DB migration | `acquire_guest_session_service` RPC |
| `entry-rate-limit.ts` | `web/src/lib/guest/` | Deleted; logic moved to sandbox.ts |
| `ipAddress` param on session entry | `actions.ts`, `sandbox.ts` | Removed entirely |

---

## Database Changes (new migration)

### New table: `guest_session_quota`

Replaces `guest_ai_quota_state` and `guest_entry_rate_limits` with a single global-scope row:

```sql
CREATE TABLE guest_session_quota (
  scope                    TEXT PRIMARY KEY DEFAULT 'global',
  active_sessions          INTEGER NOT NULL DEFAULT 0 CHECK (active_sessions >= 0),
  creation_count           INTEGER NOT NULL DEFAULT 0 CHECK (creation_count >= 0),
  creation_window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  active_requests          INTEGER NOT NULL DEFAULT 0 CHECK (active_requests >= 0),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO guest_session_quota (scope) VALUES ('global');
```

Seed the row at migration time. `active_requests` mirrors the existing `guest_ai_quota_state.active_requests` column — `guest_ai_quota_state` is dropped.

### New RPC: `acquire_guest_session_service`

```sql
CREATE OR REPLACE FUNCTION acquire_guest_session_service(
  p_active_cap     INTEGER DEFAULT 60,
  p_creation_cap   INTEGER DEFAULT 20,
  p_window_seconds INTEGER DEFAULT 3600
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_quota guest_session_quota%ROWTYPE;
  v_now   TIMESTAMPTZ := now();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('guest_session_quota'));

  SELECT * INTO v_quota FROM guest_session_quota WHERE scope = 'global' FOR UPDATE;

  -- Reset hourly creation window if expired
  IF EXTRACT(EPOCH FROM (v_now - v_quota.creation_window_started_at)) > p_window_seconds THEN
    v_quota.creation_count           := 0;
    v_quota.creation_window_started_at := v_now;
  END IF;

  -- Check caps
  IF v_quota.active_sessions >= p_active_cap THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cap_active');
  END IF;
  IF v_quota.creation_count >= p_creation_cap THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cap_creation');
  END IF;

  UPDATE guest_session_quota
  SET active_sessions = v_quota.active_sessions + 1,
      creation_count  = v_quota.creation_count  + 1,
      creation_window_started_at = v_quota.creation_window_started_at,
      updated_at      = v_now
  WHERE scope = 'global';

  RETURN jsonb_build_object('ok', true);
END;
$$;
```

### Modified RPCs

**`release_guest_session_service`** — new RPC, decrements `active_sessions` when a sandbox is expired/discarded. Called inline inside `discard_guest_sandbox` and `cleanup_expired_guest_sandboxes` (not a separate callable RPC — just a named UPDATE block within those functions):

```sql
-- Inline inside discard_guest_sandbox and cleanup_expired_guest_sandboxes
UPDATE guest_session_quota
SET active_sessions = GREATEST(active_sessions - 1, 0),
    updated_at = now()
WHERE scope = 'global';
```

**`acquire_guest_ai_slot_service` / `release_guest_ai_slot_service`** — updated to reference `guest_session_quota.active_requests` instead of the retired `guest_ai_quota_state` table. Logic is otherwise unchanged (monitoring/orphan-cleanup only — not the gate for requests).

**`cleanup_expired_guest_sandboxes`** — updated to:
1. Use 8-hour inactivity threshold (was 1 hour)
2. Decrement `guest_session_quota.active_sessions` for each sandbox cleaned up

### `guest_sandboxes` TTL constants

No schema change. The application code and RPC defaults change:

| Constant | Old | New |
|---|---|---|
| `expires_at` offset | `now() + 8h` | `now() + 32h` |
| Inactivity threshold | 60 min | 8 hours |

---

## Frontend Changes (`web/src/lib/guest/`)

### `entry-rate-limit.ts` — deleted

No replacement file needed. The check moves entirely into `sandbox.ts`.

### `sandbox.ts`

- `provisionGuestSandboxWithOptions(options?)` — `ipAddress` removed from options type
- Replace the `entry-rate-limit` call with a Supabase RPC call to `acquire_guest_session_service`
- On `reason: 'cap_active'` → throw `GuestError('too-many-active-sessions')`
- On `reason: 'cap_creation'` → throw `GuestError('too-many-new-sessions')`
- On discard / expiry → call new `release_guest_session_service` RPC

### `config.ts`

```ts
export const GUEST_SESSION_MAX_AGE_MS           = 32 * 60 * 60 * 1000;  // was 8h
export const GUEST_SESSION_INACTIVITY_TIMEOUT_MS = 8  * 60 * 60 * 1000; // was 1h
// GUEST_SESSIONS_PER_HOUR removed
```

### `errors.ts`

Two new error codes added:

```ts
'too-many-active-sessions': 'The guest demo is at capacity right now. Please try again in a few minutes.',
'too-many-new-sessions':    'Too many demo sessions have been started this hour. Please try again shortly.',
```

Existing `'too-many-guest-sessions'` error code retained for backwards compat (middleware may still surface it during transition) but no longer generated by new code.

### `actions.ts` (`startGuestSession`)

- Remove IP extraction from request headers
- Remove `ipAddress` from the call to `provisionGuestSandboxWithOptions`

---

## Backend Changes (`backend/app/`)

### `config.py`

```python
GUEST_MAX_CONCURRENT_AI_REQUESTS: int = 20   # was 10
GUEST_CHAT_LIMIT:        int = 50   # unchanged
GUEST_QUIZ_LIMIT:        int = 10   # was 5
GUEST_FLASHCARDS_LIMIT:  int = 10   # unchanged
GUEST_BLUEPRINT_LIMIT:   int = 5    # was 3
GUEST_EMBEDDING_LIMIT:   int = 15   # was 5
```

### `guest_rate_limit.py`

**Module-level semaphore:**

```python
import asyncio

_ai_semaphore: asyncio.Semaphore | None = None

def get_ai_semaphore(limit: int) -> asyncio.Semaphore:
    global _ai_semaphore
    if _ai_semaphore is None:
        _ai_semaphore = asyncio.Semaphore(limit)
    return _ai_semaphore
```

**`acquire_guest_ai_slot` (async, new signature):**

```python
async def acquire_guest_ai_slot(settings, sandbox_id: str) -> bool:
    semaphore = get_ai_semaphore(settings.GUEST_MAX_CONCURRENT_AI_REQUESTS)
    try:
        await asyncio.wait_for(semaphore.acquire(), timeout=60.0)
    except asyncio.TimeoutError:
        raise GuestConcurrencyTimeoutError()
    # DB counter update (monitoring only — awaited but errors are caught+logged, not propagated)
    # _db_acquire_slot wraps the existing acquire_guest_ai_slot_service RPC
    try:
        await _db_acquire_slot(settings, sandbox_id)
    except Exception:
        logger.warning("guest_rate_limit: DB slot counter update failed (semaphore held)", exc_info=True)
    return True
```

**`release_guest_ai_slot` (async):**

```python
async def release_guest_ai_slot(settings, sandbox_id: str) -> None:
    semaphore = get_ai_semaphore(settings.GUEST_MAX_CONCURRENT_AI_REQUESTS)
    semaphore.release()
    # _db_release_slot wraps the existing release_guest_ai_slot_service RPC
    try:
        await _db_release_slot(settings, sandbox_id)
    except Exception:
        logger.warning("guest_rate_limit: DB slot counter release failed", exc_info=True)
```

All call sites use a guarded `try / finally` — `release_guest_ai_slot` is only called if `acquire_guest_ai_slot` succeeded (i.e., did not raise). If `GuestConcurrencyTimeoutError` is raised, the semaphore was never acquired and must not be released:

```python
acquired = False
try:
    await acquire_guest_ai_slot(settings, sandbox_id)
    acquired = True
    # ... AI work ...
finally:
    if acquired:
        await release_guest_ai_slot(settings, sandbox_id)
```

**New exception type:**

```python
class GuestConcurrencyTimeoutError(Exception):
    """Raised when a guest AI slot is not available within the queue timeout."""
```

Route handlers catch `GuestConcurrencyTimeoutError` and return HTTP 503 with:

```json
{ "ok": false, "error": "Guest AI requests are busy. Please try again in a moment." }
```

---

## Data Flow Summary

```
User → POST /guest/enter
  → startGuestSession() [actions.ts]
  → provisionGuestSandboxWithOptions() [sandbox.ts]
  → acquire_guest_session_service RPC
      ├─ active_sessions >= 60 → 'too-many-active-sessions'
      ├─ creation_count  >= 20 → 'too-many-new-sessions'
      └─ ok → create anon user → clone sandbox → redirect

User → AI feature (chat / quiz / flashcards / blueprint / embedding)
  → Backend checks per-feature quota (in-memory, unchanged)
  → acquire_guest_ai_slot() [async]
      ├─ asyncio.Semaphore(20).acquire() with 60s timeout
      │     queues if all slots taken; raises TimeoutError after 60s
      └─ DB counter updated (monitoring)
  → AI call executes
  → release_guest_ai_slot() [finally block]
  → increment_guest_ai_usage() [on success only]

Session ends (expiry / discard)
  → release_guest_session_service RPC (decrement active_sessions)
  → cleanup_expired_guest_sandboxes (batch job, unchanged cadence)
```

---

## Files to Create / Modify

| File | Action |
|---|---|
| `supabase/migrations/0023_guest_quota_redesign.sql` | Create — new table, new/updated RPCs, drop old table |
| `web/src/lib/guest/config.ts` | Modify — TTL constants |
| `web/src/lib/guest/entry-rate-limit.ts` | Delete |
| `web/src/lib/guest/sandbox.ts` | Modify — remove IP, replace rate-limit call |
| `web/src/lib/guest/errors.ts` | Modify — two new error codes |
| `web/src/app/actions.ts` | Modify — remove IP forwarding |
| `backend/app/config.py` | Modify — quota defaults |
| `backend/app/guest_rate_limit.py` | Modify — asyncio semaphore, async acquire/release |

---

## Verification

1. **Guest entry — active cap:** Manually set `active_sessions = 60` in DB, attempt `/guest/enter` → expect "at capacity" error, not IP error.
2. **Guest entry — creation rate:** Set `creation_count = 20` in current window → expect "too many this hour" error.
3. **No IP tracking:** Confirm `guest_entry_rate_limits` table is dropped; confirm no IP headers read in `actions.ts` or `sandbox.ts`.
4. **TTL:** Create a sandbox, manually set `expires_at = now() + 31h` — middleware should not expire it. Set `last_seen_at = now() - 7h` — middleware should not expire it. Set `last_seen_at = now() - 9h` — should expire.
5. **Queuing:** Saturate the semaphore by holding 20 slots open (mock), fire a 21st request — it should wait, not 503 immediately. After a slot is released, the waiting request should proceed.
6. **Timeout:** Hold all 20 slots for 61 seconds — 21st request should receive 503 after ~60s with the "busy" message.
7. **Feature quotas:** Confirm new limits in `config.py` match spec (quiz=10, blueprint=5, embedding=15).
8. **Vitest:** Run `pnpm --dir web vitest run` — no regressions in guest-related unit tests.
