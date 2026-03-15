from __future__ import annotations

import path_setup  # noqa: F401  # pyright: ignore[reportUnusedImport]

import unittest
from unittest.mock import patch

from app.materials import (
    _coerce_errors,
    _coerce_non_negative_int,
    dispatch_material_job,
    process_material_jobs,
)
from app.schemas import MaterialDispatchRequest, MaterialProcessRequest
from tests.helpers import make_settings


class MaterialsTests(unittest.TestCase):
    def test_coerce_helpers(self) -> None:
        self.assertEqual(_coerce_non_negative_int("5"), 5)
        self.assertEqual(_coerce_non_negative_int("bad"), 0)
        self.assertEqual(_coerce_errors(["a", " ", 1]), ["a"])

    def test_process_material_jobs_maps_payload(self) -> None:
        settings = make_settings()
        request = MaterialProcessRequest(batch_size=2)

        with patch("app.materials.trigger_material_worker", return_value={
            "processed": "3",
            "succeeded": 2,
            "failed": 1,
            "retried": 0,
            "errors": ["e1"],
        }):
            result = process_material_jobs(settings, request)

        self.assertEqual(result.processed, 3)
        self.assertEqual(result.succeeded, 2)
        self.assertEqual(result.errors, ["e1"])

    def test_dispatch_material_job_enqueues_and_triggers_worker(self) -> None:
        settings = make_settings(
            supabase_url="https://example.supabase.co",
            supabase_service_role_key="service-role",
        )
        request = MaterialDispatchRequest(
            class_id="class-1",
            material_id="material-1",
            trigger_worker=True,
        )

        enqueue_response = _FakeResponse(
            status_code=200,
            payload={"ok": True},
        )
        trigger_response = _FakeResponse(
            status_code=200,
            payload={"processed": 1, "succeeded": 1, "failed": 0, "retried": 0, "errors": []},
        )
        fake_client = _FakeHttpxClient([enqueue_response, trigger_response])

        with patch("app.materials.httpx.Client", return_value=fake_client):
            result = dispatch_material_job(settings, request)

        self.assertTrue(result.enqueued)
        self.assertTrue(result.triggered)
        self.assertEqual(len(fake_client.post_calls), 2)

        enqueue_url, enqueue_kwargs = fake_client.post_calls[0]
        self.assertEqual(
            enqueue_url,
            "https://example.supabase.co/rest/v1/rpc/enqueue_material_job",
        )
        self.assertEqual(
            enqueue_kwargs.get("json"),
            {
                "p_material_id": "material-1",
                "p_class_id": "class-1",
            },
        )

        worker_url, worker_kwargs = fake_client.post_calls[1]
        self.assertEqual(
            worker_url,
            "https://example.supabase.co/functions/v1/material-worker",
        )
        self.assertEqual(
            worker_kwargs.get("json"),
            {"batchSize": settings.material_worker_batch},
        )


class _FakeResponse:
    def __init__(self, *, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload

    def json(self) -> dict:
        return self._payload


class _FakeHttpxClient:
    def __init__(self, responses: list[_FakeResponse]):
        self._responses = responses
        self.post_calls: list[tuple[str, dict]] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def post(self, url: str, **kwargs):
        self.post_calls.append((url, kwargs))
        if not self._responses:
            raise AssertionError("No fake HTTP responses left.")
        return self._responses.pop(0)


if __name__ == "__main__":
    unittest.main()
