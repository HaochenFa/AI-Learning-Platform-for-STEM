# STEM Python Backend

FastAPI backend for AI provider orchestration (OpenAI, Gemini, OpenRouter) with
fallback and deterministic response envelopes.

## Endpoints

- `GET /healthz`
- `POST /v1/llm/generate`
- `POST /v1/llm/embeddings`
- `POST /v1/materials/dispatch` (enqueue + optionally trigger Supabase `material-worker`)

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

1. Install dependencies:

```bash
pip install -r backend/requirements.txt
```

2. Set env vars (same AI vars already used by `web`), plus optional:

- `PYTHON_BACKEND_API_KEY` for internal auth.
- `PYTHON_BACKEND_LOG_PROVIDER_FAILURES=true` (default).
- For materials dispatch middleware mode:
  - `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`)
  - `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`)
  - `MATERIAL_WORKER_TOKEN` (if your Edge worker requires bearer auth)
  - `MATERIAL_WORKER_FUNCTION_URL` (optional override; defaults to `${SUPABASE_URL}/functions/v1/material-worker`)

3. Start the service:

```bash
uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8001 --reload
```
