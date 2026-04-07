# Material Dispatch Auth Alignment Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make valid material uploads enqueue reliably by aligning the web -> Python backend -> Supabase auth chain with the user-scoped `enqueue_material_job` RPC, so successful uploads stop falling into the false "Processing could not be started..." failure state.

**Architecture:** Treat `POST /v1/materials/dispatch` as a user-bound backend route, just like class create/join. The web server action will forward the current Supabase session bearer token to FastAPI; FastAPI will validate that actor token and pass it through to the Supabase RPC call so `public.requesting_user_id()` and teacher-access checks evaluate against the real uploader instead of a service-only credential. `POST /v1/materials/process` stays service-authenticated and unchanged, and no SQL migration is required.

**Tech Stack:** Next.js 16 server actions, TypeScript, FastAPI, httpx, Supabase REST/RPC, Vitest, Python `unittest`

---

## File Structure

- Modify: `backend/app/main.py`
  - Make `/v1/materials/dispatch` require a real actor bearer token while leaving `/v1/materials/process` on service-auth only.
- Modify: `backend/app/materials.py`
  - Send the actor bearer token to Supabase REST RPC `enqueue_material_job` and stop authenticating that RPC as service-role bearer auth.
- Modify: `backend/tests/test_main.py`
  - Lock the route-level auth contract for dispatch vs process.
- Modify: `backend/tests/test_materials.py`
  - Lock the outbound Supabase RPC header contract for enqueue.
- Modify: `web/src/app/classes/actions.ts`
  - Forward the upload session bearer token during material dispatch and keep failure rollback deterministic.
- Modify: `web/src/app/classes/actions.test.ts`
  - Lock the frontend regression around dispatch Authorization header forwarding and missing-session-token rollback.
- Modify: `.codex/architecture.md`
  - Record that material dispatch is a user-bound route and that the RPC executes under the caller JWT.
- Modify: `.codex/testing.md`
  - Record the new backend/frontend regression tests and mock expectations.

## Constraints

- Do not add a new migration or alter `supabase/migrations/0008_material_queue_worker.sql`.
- Do not change `triggerMaterialProcessing()` or `POST /v1/materials/process` auth behavior; that route wakes the worker and is not the source of the enqueue failure.
- Preserve the existing rollback semantics for deterministic dispatch failures.
- Keep commit messages verbose, with a subject and body, per `AGENTS.md`.

### Task 1: Make `/v1/materials/dispatch` a user-bound backend route

**Files:**
- Modify: `backend/tests/test_main.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_main.py`

- [ ] **Step 1: Write the failing backend route-auth tests**

Add these tests to `backend/tests/test_main.py` inside `MainTests`:

```python
    def test_material_dispatch_route_requires_user_token(self) -> None:
        settings = make_settings(python_backend_api_key="secret")
        client = TestClient(app)
        with patch("app.main.get_settings", return_value=settings):
            response = client.post(
                "/v1/materials/dispatch",
                headers={"x-api-key": "secret"},
                json={
                    "class_id": "class-1",
                    "material_id": "material-1",
                    "trigger_worker": False,
                },
            )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"]["code"], "user_token_required")

    def test_material_process_route_keeps_service_auth_contract(self) -> None:
        settings = make_settings(python_backend_api_key="secret")
        client = TestClient(app)
        process_result = type(
            "MaterialProcessResultStub",
            (),
            {
                "model_dump": lambda self: {
                    "triggered": True,
                    "processed": 1,
                    "succeeded": 1,
                    "failed": 0,
                    "retried": 0,
                    "errors": [],
                }
            },
        )()

        with (
            patch("app.main.get_settings", return_value=settings),
            patch("app.main.run_in_threadpool", return_value=process_result),
        ):
            response = client.post(
                "/v1/materials/process",
                headers={"x-api-key": "secret"},
                json={"batch_size": 1},
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])
        self.assertTrue(response.json()["data"]["triggered"])
```

- [ ] **Step 2: Run the backend route-auth tests and verify the new dispatch test fails**

Run:

```bash
python3 -m unittest \
  backend.tests.test_main.MainTests.test_material_dispatch_route_requires_user_token \
  backend.tests.test_main.MainTests.test_material_process_route_keeps_service_auth_contract \
  -v
```

Expected:

```text
test_material_dispatch_route_requires_user_token ... FAIL
test_material_process_route_keeps_service_auth_contract ... ok
```

The current failure should show that `/v1/materials/dispatch` still returns `200` or `502` instead of the expected `401 user_token_required`.

- [ ] **Step 3: Update the FastAPI route to require an actor bearer token**

Replace the dispatch route in `backend/app/main.py` with this implementation:

```python
@app.post("/v1/materials/dispatch")
async def dispatch_materials(request: Request, payload: MaterialDispatchRequest):
    settings, _, unauthorized = await _authorize_request(request, require_actor_user=True)
    if unauthorized:
        return unauthorized

    actor_access_token = _parse_bearer_token(request.headers.get("authorization"))
    if not actor_access_token or actor_access_token == settings.python_backend_api_key:
        return _error_response(
            request,
            status_code=401,
            message="A valid user bearer token is required.",
            code="user_token_required",
        )

    try:
        result = await run_in_threadpool(
            dispatch_material_job,
            settings,
            payload,
            actor_access_token,
        )
        return ApiEnvelope(
            ok=True,
            data=result.model_dump(),
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="dispatch_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )
```

Do not modify `@app.post("/v1/materials/process")`.

- [ ] **Step 4: Re-run the backend route-auth tests and verify they pass**

Run:

```bash
python3 -m unittest \
  backend.tests.test_main.MainTests.test_material_dispatch_route_requires_user_token \
  backend.tests.test_main.MainTests.test_material_process_route_keeps_service_auth_contract \
  -v
```

Expected:

```text
test_material_dispatch_route_requires_user_token ... ok
test_material_process_route_keeps_service_auth_contract ... ok
```

- [ ] **Step 5: Commit the route-auth boundary change**

Run:

```bash
git add backend/tests/test_main.py backend/app/main.py
git commit -m "fix: require user auth for material dispatch" \
  -m "Treat /v1/materials/dispatch as a user-bound backend route so uploads can enqueue against the caller context." \
  -m "Keep /v1/materials/process service-authenticated and lock the behavior with backend route tests."
```

### Task 2: Use the caller JWT for the enqueue RPC

**Files:**
- Modify: `backend/tests/test_materials.py`
- Modify: `backend/app/materials.py`
- Test: `backend/tests/test_materials.py`

- [ ] **Step 1: Write the failing dispatcher test for Supabase RPC headers**

Add this test to `backend/tests/test_materials.py`:

```python
    def test_dispatch_material_job_uses_actor_token_for_enqueue_rpc(self) -> None:
        settings = make_settings(
            supabase_url="https://example.supabase.co",
            supabase_publishable_key="publishable-key",
            supabase_service_role_key="service-role",
        )
        request = MaterialDispatchRequest(
            class_id="class-1",
            material_id="material-1",
            trigger_worker=False,
        )

        enqueue_response = _FakeResponse(status_code=200, payload={"ok": True})
        fake_client = _FakeHttpxClient([enqueue_response])

        with patch("app.materials.httpx.Client", return_value=fake_client):
            result = dispatch_material_job(
                settings,
                request,
                actor_access_token="teacher-jwt",
            )

        self.assertTrue(result.enqueued)
        enqueue_url, enqueue_kwargs = fake_client.post_calls[0]
        self.assertEqual(
            enqueue_url,
            "https://example.supabase.co/rest/v1/rpc/enqueue_material_job",
        )
        self.assertEqual(
            enqueue_kwargs["headers"]["Authorization"],
            "Bearer teacher-jwt",
        )
        self.assertEqual(
            enqueue_kwargs["headers"]["apikey"],
            "publishable-key",
        )
```

Also update the existing `test_dispatch_material_job_enqueues_and_triggers_worker` call site to pass the new argument:

```python
            result = dispatch_material_job(
                settings,
                request,
                actor_access_token="teacher-jwt",
            )
```

- [ ] **Step 2: Run the dispatcher tests and verify the new header assertion fails**

Run:

```bash
python3 -m unittest \
  backend.tests.test_materials.MaterialsTests.test_dispatch_material_job_uses_actor_token_for_enqueue_rpc \
  backend.tests.test_materials.MaterialsTests.test_dispatch_material_job_enqueues_and_triggers_worker \
  -v
```

Expected:

```text
test_dispatch_material_job_uses_actor_token_for_enqueue_rpc ... FAIL
test_dispatch_material_job_enqueues_and_triggers_worker ... ERROR
```

The first failure should show the wrong `Authorization` header, and the second should fail until the function signature is updated everywhere.

- [ ] **Step 3: Update the backend material dispatcher to use the actor token for the RPC**

Change the function signature and headers in `backend/app/materials.py` to this:

```python
def dispatch_material_job(
    settings: Settings,
    request: MaterialDispatchRequest,
    actor_access_token: str,
) -> MaterialDispatchResult:
    """Enqueue a material for background processing and optionally wake the worker."""
    if not settings.supabase_url:
        raise RuntimeError("Supabase URL is not configured on Python backend.")

    rest_api_key = settings.supabase_publishable_key or settings.supabase_service_role_key
    if not rest_api_key:
        raise RuntimeError(
            "Supabase REST API credentials are not configured on Python backend."
        )

    headers = {
        "apikey": rest_api_key,
        "Authorization": f"Bearer {actor_access_token}",
        "Content-Type": "application/json",
    }
    timeout_seconds = max(5, settings.ai_request_timeout_ms / 1000)

    with httpx.Client(timeout=timeout_seconds, trust_env=False) as client:
        enqueue_url = f"{settings.supabase_url.rstrip('/')}/rest/v1/rpc/enqueue_material_job"
        enqueue_response = client.post(
            enqueue_url,
            headers=headers,
            json={
                "p_material_id": request.material_id,
                "p_class_id": request.class_id,
            },
        )

        enqueue_payload = _safe_json(enqueue_response)
        if enqueue_response.status_code >= 400:
            message = _extract_error_message(enqueue_payload) or "Failed to enqueue material job."
            raise RuntimeError(message)

        triggered = False
        if request.trigger_worker:
            trigger_material_worker(settings, client=client)
            triggered = True

    return MaterialDispatchResult(enqueued=True, triggered=triggered)
```

Do not change `trigger_material_worker()` in this task.

- [ ] **Step 4: Re-run the dispatcher tests and verify they pass**

Run:

```bash
python3 -m unittest \
  backend.tests.test_materials.MaterialsTests.test_dispatch_material_job_uses_actor_token_for_enqueue_rpc \
  backend.tests.test_materials.MaterialsTests.test_dispatch_material_job_enqueues_and_triggers_worker \
  -v
```

Expected:

```text
test_dispatch_material_job_uses_actor_token_for_enqueue_rpc ... ok
test_dispatch_material_job_enqueues_and_triggers_worker ... ok
```

- [ ] **Step 5: Commit the RPC-auth fix**

Run:

```bash
git add backend/tests/test_materials.py backend/app/materials.py
git commit -m "fix: enqueue materials with the actor jwt" \
  -m "Call the Supabase enqueue RPC with the uploader bearer token so requesting_user_id() and teacher access checks evaluate correctly." \
  -m "Keep the worker wake-up path separate and lock the outbound header contract in backend tests."
```

### Task 3: Forward the upload session token from the web server action

**Files:**
- Modify: `web/src/app/classes/actions.test.ts`
- Modify: `web/src/app/classes/actions.ts`
- Test: `web/src/app/classes/actions.test.ts`

- [ ] **Step 1: Write the failing frontend regression tests**

In `web/src/app/classes/actions.test.ts`, extend the existing finalize-upload success path and add a missing-token rollback test:

```ts
  it("forwards the current session token when dispatching material processing", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";
    vi.mocked(sanitizeFilename).mockReturnValue("lecture.pdf");
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, data: { enqueued: true, triggered: false } }),
    } as Response);

    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeBuilder({ data: { id: "class-1", owner_id: "u1" }, error: null });
      }
      if (table === "enrollments") {
        return makeBuilder({ data: null, error: null });
      }
      if (table === "materials") {
        return makeBuilder({ data: { id: "m1" }, error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    const result = await finalizeMaterialUpload("class-1", {
      materialId: "mat-1",
      storagePath: "classes/class-1/mat-1/lecture.pdf",
      title: "Lecture 1",
      filename: "lecture.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      triggerWorker: false,
    });

    expect(result).toEqual({
      ok: true,
      materialId: "m1",
      uploadNotice: "processing",
    });

    const fetchMock = vi.mocked(global.fetch);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect((init as RequestInit)?.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer session-token",
      }),
    );
  });

  it("rolls back the material when the upload context has no session token", async () => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";
    vi.mocked(sanitizeFilename).mockReturnValue("lecture.pdf");
    vi.mocked(requireGuestOrVerifiedUser).mockResolvedValueOnce({
      supabase: {
        from: supabaseFromMock,
        rpc: supabaseRpcMock,
        storage: supabaseStorageMock,
      },
      user: { id: "u1", email: "user@example.com" },
      profile: { id: "u1", account_type: "teacher" },
      accountType: "teacher",
      isEmailVerified: true,
      accessToken: null,
      isGuest: false,
      sandboxId: null,
      guestRole: null,
      guestClassId: null,
    } as never);

    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "classes") {
        return makeBuilder({ data: { id: "class-1", owner_id: "u1" }, error: null });
      }
      if (table === "enrollments") {
        return makeBuilder({ data: null, error: null });
      }
      if (table === "materials") {
        return makeBuilder({ data: { id: "m1" }, error: null });
      }
      return makeBuilder({ data: null, error: null });
    });

    const result = await finalizeMaterialUpload("class-1", {
      materialId: "mat-1",
      storagePath: "classes/class-1/mat-1/lecture.pdf",
      title: "Lecture 1",
      filename: "lecture.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      triggerWorker: false,
    });

    expect(result).toEqual({
      ok: false,
      error: "Failed to queue material processing: Session token is missing. Please sign in again.",
    });
    expect(bucketMock.remove).toHaveBeenCalledWith(["classes/class-1/mat-1/lecture.pdf"]);
  });
```

- [ ] **Step 2: Run the frontend tests and verify the new assertions fail**

Run:

```bash
pnpm --dir web exec vitest run src/app/classes/actions.test.ts
```

Expected:

```text
FAIL  src/app/classes/actions.test.ts
```

The existing finalize-upload success path should now fail because the dispatch request does not send `Authorization`, and the new rollback test should fail until the missing-token guard is added.

- [ ] **Step 3: Forward the session token and add the missing-token guard**

In `web/src/app/classes/actions.ts`, make these changes:

```ts
async function dispatchMaterialJobViaPythonBackend(input: {
  classId: string;
  materialId: string;
  accessToken: string;
  triggerWorker?: boolean;
}) {
  const baseUrl = process.env.PYTHON_BACKEND_URL?.trim();
  if (!baseUrl) {
    throw createPythonMaterialDispatchError("PYTHON_BACKEND_URL is not configured.", true);
  }

  const apiKey = process.env.PYTHON_BACKEND_API_KEY?.trim();
  const timeoutMs = resolvePythonBackendTimeoutMs();
  let didTimeout = false;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/materials/dispatch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.accessToken}`,
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      body: JSON.stringify({
        class_id: input.classId,
        material_id: input.materialId,
        trigger_worker: input.triggerWorker ?? true,
      }),
      signal: controller.signal,
    });
```

And inside `finalizeMaterialUploadInternal`, insert the explicit access-token guard immediately before the dispatch call:

```ts
  const dispatchAccessToken = accessContext.accessToken;
  if (!dispatchAccessToken) {
    await rollbackUploadedMaterial(
      accessContext.storageClient,
      accessContext.supabase,
      materialRow.id,
      input.storagePath,
    );
    return {
      ok: false,
      error: "Failed to queue material processing: Session token is missing. Please sign in again.",
    };
  }

  try {
    await dispatchMaterialJobViaPythonBackend({
      classId,
      materialId: materialRow.id,
      accessToken: dispatchAccessToken,
      triggerWorker: input.triggerWorker ?? false,
    });
```

Do not change `triggerMaterialProcessing()` in this task.

- [ ] **Step 4: Re-run the frontend tests and verify they pass**

Run:

```bash
pnpm --dir web exec vitest run src/app/classes/actions.test.ts
```

Expected:

```text
✓ src/app/classes/actions.test.ts
```

- [ ] **Step 5: Commit the web dispatch fix**

Run:

```bash
git add web/src/app/classes/actions.ts web/src/app/classes/actions.test.ts
git commit -m "fix: forward session auth for material dispatch" \
  -m "Send the current Supabase bearer token from finalizeMaterialUpload to the Python dispatch route so enqueue runs under the uploader context." \
  -m "Add a deterministic missing-session-token rollback path and frontend regression tests for both cases."
```

### Task 4: Refresh architecture and testing docs

**Files:**
- Modify: `.codex/architecture.md`
- Modify: `.codex/testing.md`

- [ ] **Step 1: Update `.codex/architecture.md` with the dispatch-auth note**

Add or revise the material-processing bullets so they say:

```md
- Material processing remains queue-backed via the Python backend + Supabase Edge Function worker.
- `finalizeMaterialUpload` now forwards the caller's Supabase session bearer token to `POST /v1/materials/dispatch`; the backend validates that actor token and uses it when calling `enqueue_material_job`, so the SQL-side `requesting_user_id()` and teacher-access checks run under the real uploader context.
- `POST /v1/materials/process` is still a service-authenticated worker wake-up path and is not used to authorize queue insertion.
```

Also refresh the `Last updated:` line at the top with the current HKT timestamp.

- [ ] **Step 2: Update `.codex/testing.md` with the new regression coverage**

Add or revise the testing bullets so they say:

```md
- Backend route-auth coverage now distinguishes user-bound `/v1/materials/dispatch` from service-authenticated `/v1/materials/process` in `backend/tests/test_main.py`.
- Backend material dispatch tests in `backend/tests/test_materials.py` assert that the enqueue RPC uses the actor bearer token in `Authorization` and the configured Supabase REST API key in `apikey`.
- Frontend material-upload tests in `web/src/app/classes/actions.test.ts` now assert that `finalizeMaterialUpload` forwards `accessToken` to the Python dispatch route and rolls back deterministically when the auth context has no session token.
```

Also refresh the `Last updated:` line at the top with the current HKT timestamp.

- [ ] **Step 3: Verify the docs contain the new notes**

Run:

```bash
rg -n "caller's Supabase session bearer token|user-bound `/v1/materials/dispatch`|actor bearer token" \
  .codex/architecture.md .codex/testing.md
```

Expected:

```text
.codex/architecture.md:...
.codex/testing.md:...
```

- [ ] **Step 4: Commit the doc refresh**

Run:

```bash
git add .codex/architecture.md .codex/testing.md
git commit -m "docs: record the material dispatch auth contract" \
  -m "Refresh architecture and testing notes to show that queue insertion now runs under the uploader bearer token while worker wake-up stays service-authenticated." \
  -m "Document the backend and frontend regression tests added for the upload dispatch fix."
```

### Final Verification

**Files:**
- Test: `backend/tests/test_main.py`
- Test: `backend/tests/test_materials.py`
- Test: `web/src/app/classes/actions.test.ts`

- [ ] **Step 1: Run the focused regression suite**

Run:

```bash
python3 -m unittest \
  backend.tests.test_main.MainTests.test_material_dispatch_route_requires_user_token \
  backend.tests.test_main.MainTests.test_material_process_route_keeps_service_auth_contract \
  backend.tests.test_materials.MaterialsTests.test_dispatch_material_job_uses_actor_token_for_enqueue_rpc \
  backend.tests.test_materials.MaterialsTests.test_dispatch_material_job_enqueues_and_triggers_worker \
  -v
pnpm --dir web exec vitest run src/app/classes/actions.test.ts
```

Expected:

```text
OK
✓ src/app/classes/actions.test.ts
```

- [ ] **Step 2: Run the broader backend and web suites that cover touched files**

Run:

```bash
python3 -m unittest discover -s backend/tests -p 'test_*.py'
pnpm --dir web test
```

Expected:

```text
OK
Test Files  ... passed
```

- [ ] **Step 3: Inspect the final diff before handing off**

Run:

```bash
git diff --stat HEAD~4..HEAD
git diff -- backend/app/main.py backend/app/materials.py backend/tests/test_main.py backend/tests/test_materials.py web/src/app/classes/actions.ts web/src/app/classes/actions.test.ts .codex/architecture.md .codex/testing.md
```

Expected:

```text
Only the planned files above are changed, with no migration or worker-function edits.
```
