"""Vercel FastAPI entrypoint.

Vercel auto-detects FastAPI apps when an `app` variable is exported from
`index.py` (or other supported entrypoints).
"""

from app.main import app
