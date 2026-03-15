# STEM Python Backend

FastAPI backend for AI provider orchestration (OpenAI, Gemini, OpenRouter) with
fallback and deterministic response envelopes.

## Endpoints

- `GET /healthz`
- `POST /v1/llm/generate`
- `POST /v1/llm/embeddings`
- `POST /v1/materials/dispatch` (enqueue + optionally trigger Supabase `material-worker`)
- `POST /v1/materials/process` (trigger Supabase `material-worker` batch processing run)
- `POST /v1/classes/create` (class creation; requires a valid user JWT in `Authorization: Bearer`)
- `POST /v1/classes/join` (join by class code; requires a valid user JWT in `Authorization: Bearer`)
- `POST /v1/blueprints/generate` (domain endpoint for blueprint AI generation)
- `POST /v1/quiz/generate` (domain endpoint for quiz AI generation)
- `POST /v1/flashcards/generate` (domain endpoint for flashcards AI generation)
- `POST /v1/chat/generate` (domain endpoint for grounded chat AI generation; requires a valid user JWT)
  - requires `class_id` and `user_id` in request payload for tenant-safe memory/thread isolation
  - supports `direct_v1` and optional `langgraph_v1` orchestration via request hints
  - `langgraph_v1` uses LangChain `create_agent` + LangGraph short-term memory (checkpointer) + long-term memory (store tools)
  - default tool catalog: `grounding_context.read`, `memory.search`, `memory.save`
  - if LangChain/LangGraph runtime is unavailable, it automatically falls back to `direct_v1`
- `POST /v1/chat/workspace/participants` (teacher monitoring participant list for class chat workspace)
- `POST /v1/chat/workspace/sessions/list` (class chat workspace session list by owner)
- `POST /v1/chat/workspace/sessions/create` (create class chat workspace session)
- `POST /v1/chat/workspace/sessions/rename` (rename class chat workspace session)
- `POST /v1/chat/workspace/sessions/archive` (archive class chat workspace session)
- `POST /v1/chat/workspace/messages/list` (paginated class chat workspace message history)
- `POST /v1/chat/workspace/messages/send` (class chat workspace message send + grounded response orchestration + persistence)

Response envelope:

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "meta": { "request_id": "..." }
}
```

## Local Run

1. Install dependencies (Python 3.11+ required):

```bash
pip install -r backend/requirements.txt
```

2. Set env vars (same AI vars already used by `web`), plus optional:

- `PYTHON_BACKEND_API_KEY` for internal auth.
- `PYTHON_BACKEND_ALLOW_UNAUTHENTICATED_REQUESTS=false` (default). Keep disabled in non-local environments.
- `PYTHON_BACKEND_LOG_PROVIDER_FAILURES=true` (default).
- For materials dispatch middleware mode:
  - `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`)
  - `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`)
  - `MATERIAL_WORKER_TOKEN` (if your Edge worker requires bearer auth)
  - `MATERIAL_WORKER_FUNCTION_URL` (optional override; defaults to `${SUPABASE_URL}/functions/v1/material-worker`)
  - `MATERIAL_WORKER_BATCH` (default batch size used by `/v1/materials/process` and dispatch-trigger)

3. Start the service:

```bash
uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8001 --reload
```

## Tests

Run Python backend unit tests:

```bash
python3 -m unittest discover -s backend/tests -p 'test_*.py'
```
