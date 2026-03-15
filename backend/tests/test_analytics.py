from __future__ import annotations

import path_setup  # noqa: F401  # pyright: ignore[reportUnusedImport]

import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, call, patch

from app.analytics import (
    ClassInsightsRequest,
    _build_empty_payload,
    _check_teacher_enrollment,
    _get_cached_snapshot,
    compute_risk_level,
    compute_topic_status,
    format_display_name,
    get_class_insights,
)
from app.classes import ClassDomainError
from tests.helpers import make_settings


class FormatDisplayNameTests(unittest.TestCase):
    def test_two_words(self) -> None:
        self.assertEqual(format_display_name("Billy Fang"), "Billy F.")

    def test_single_word(self) -> None:
        self.assertEqual(format_display_name("Alice"), "Alice")

    def test_many_words(self) -> None:
        self.assertEqual(format_display_name("Mary Jane Watson"), "Mary W.")

    def test_none(self) -> None:
        self.assertEqual(format_display_name(None), "Unknown")

    def test_empty_string(self) -> None:
        self.assertEqual(format_display_name("  "), "Unknown")


class RiskLevelTests(unittest.TestCase):
    def test_high_risk(self) -> None:
        # Both below thresholds
        self.assertEqual(compute_risk_level(0.55, 0.40), "high")

    def test_medium_risk_low_score(self) -> None:
        # Score below 0.70, completion OK
        self.assertEqual(compute_risk_level(0.65, 0.60), "medium")

    def test_medium_risk_low_completion(self) -> None:
        # Score OK, completion below 0.50
        self.assertEqual(compute_risk_level(0.80, 0.45), "medium")

    def test_low_risk(self) -> None:
        self.assertEqual(compute_risk_level(0.85, 0.90), "low")

    def test_boundary_medium_not_high(self) -> None:
        # avg_score < 0.60 but completion >= 0.50: medium not high
        self.assertEqual(compute_risk_level(0.50, 0.55), "medium")

    def test_boundary_score_exactly_60_completion_below_50(self) -> None:
        # score == 0.60, NOT < 0.60, completion < 0.50 → medium
        self.assertEqual(compute_risk_level(0.60, 0.40), "medium")


class TopicStatusTests(unittest.TestCase):
    def test_critical(self) -> None:
        self.assertEqual(compute_topic_status(0.59), "critical")

    def test_warning_lower_bound(self) -> None:
        self.assertEqual(compute_topic_status(0.60), "warning")

    def test_warning_upper_bound(self) -> None:
        self.assertEqual(compute_topic_status(0.75), "warning")

    def test_good(self) -> None:
        self.assertEqual(compute_topic_status(0.76), "good")
        self.assertEqual(compute_topic_status(1.0), "good")


class EmptyPayloadTests(unittest.TestCase):
    def test_is_empty_flag(self) -> None:
        payload = _build_empty_payload()
        self.assertTrue(payload["class_summary"]["is_empty"])

    def test_all_zeros(self) -> None:
        payload = _build_empty_payload()
        summary = payload["class_summary"]
        self.assertEqual(summary["student_count"], 0)
        self.assertEqual(summary["avg_score"], 0.0)
        self.assertEqual(summary["completion_rate"], 0.0)
        self.assertEqual(summary["at_risk_count"], 0)

    def test_empty_arrays(self) -> None:
        payload = _build_empty_payload()
        self.assertEqual(payload["topics"], [])
        self.assertEqual(payload["students"], [])

    def test_bloom_breakdown_all_null(self) -> None:
        payload = _build_empty_payload()
        for level in ("remember", "understand", "apply", "analyze", "evaluate", "create"):
            self.assertIsNone(payload["bloom_breakdown"][level])


class CachedSnapshotTests(unittest.TestCase):
    def test_returns_none_when_no_rows(self) -> None:
        settings = make_settings()
        client = MagicMock()
        client.get.return_value = MagicMock(json=MagicMock(return_value=[]))
        result = _get_cached_snapshot(client, settings, "class-1")
        self.assertIsNone(result)

    def test_returns_none_when_snapshot_expired(self) -> None:
        settings = make_settings()
        old_time = (datetime.now(UTC) - timedelta(hours=2)).isoformat()
        client = MagicMock()
        client.get.return_value = MagicMock(
            json=MagicMock(return_value=[{"payload": {"ok": True}, "generated_at": old_time}])
        )
        result = _get_cached_snapshot(client, settings, "class-1")
        self.assertIsNone(result)

    def test_returns_payload_when_fresh(self) -> None:
        settings = make_settings()
        fresh_time = (datetime.now(UTC) - timedelta(minutes=5)).isoformat()
        expected_payload = {"class_summary": {"student_count": 5}, "is_empty": False}
        client = MagicMock()
        client.get.return_value = MagicMock(
            json=MagicMock(return_value=[{"payload": expected_payload, "generated_at": fresh_time}])
        )
        result = _get_cached_snapshot(client, settings, "class-1")
        self.assertEqual(result, expected_payload)


class TeacherEnrollmentCheckTests(unittest.TestCase):
    def test_raises_403_when_not_enrolled(self) -> None:
        settings = make_settings()
        client = MagicMock()
        client.get.return_value = MagicMock(
            json=MagicMock(return_value=[])
        )
        with self.assertRaises(ClassDomainError) as ctx:
            _check_teacher_enrollment(client, settings, "user-1", "class-1")
        self.assertEqual(ctx.exception.status_code, 403)

    def test_raises_403_for_student_role(self) -> None:
        settings = make_settings()
        client = MagicMock()
        client.get.return_value = MagicMock(
            json=MagicMock(return_value=[{"role": "student"}])
        )
        with self.assertRaises(ClassDomainError) as ctx:
            _check_teacher_enrollment(client, settings, "user-1", "class-1")
        self.assertEqual(ctx.exception.status_code, 403)

    def test_passes_for_teacher_role(self) -> None:
        settings = make_settings()
        client = MagicMock()
        client.get.return_value = MagicMock(
            json=MagicMock(return_value=[{"role": "teacher"}])
        )
        # Should not raise
        _check_teacher_enrollment(client, settings, "user-1", "class-1")

    def test_passes_for_ta_role(self) -> None:
        settings = make_settings()
        client = MagicMock()
        client.get.return_value = MagicMock(
            json=MagicMock(return_value=[{"role": "ta"}])
        )
        _check_teacher_enrollment(client, settings, "user-1", "class-1")


class GetClassInsightsCacheTests(unittest.TestCase):
    """Test that cache bypass logic works correctly."""

    def _make_fresh_snapshot(self) -> dict:
        fresh_time = (datetime.now(UTC) - timedelta(minutes=5)).isoformat()
        return {
            "class_summary": {"student_count": 3, "is_empty": False},
            "generated_at": fresh_time,
        }

    @patch("app.analytics._generate_insights_payload")
    @patch("app.analytics._upsert_snapshot")
    @patch("app.analytics._get_cached_snapshot")
    @patch("app.analytics._check_teacher_enrollment")
    def test_returns_cache_when_fresh_and_no_force_refresh(
        self,
        mock_check: MagicMock,
        mock_get_cache: MagicMock,
        mock_upsert: MagicMock,
        mock_generate: MagicMock,
    ) -> None:
        settings = make_settings()
        cached = self._make_fresh_snapshot()
        mock_get_cache.return_value = cached

        result = get_class_insights(settings, ClassInsightsRequest(
            user_id="teacher-1", class_id="class-1", force_refresh=False
        ))

        self.assertEqual(result, cached)
        mock_generate.assert_not_called()
        mock_upsert.assert_not_called()

    @patch("app.analytics._generate_insights_payload")
    @patch("app.analytics._upsert_snapshot")
    @patch("app.analytics._get_cached_snapshot")
    @patch("app.analytics._check_teacher_enrollment")
    def test_regenerates_when_force_refresh_true(
        self,
        mock_check: MagicMock,
        mock_get_cache: MagicMock,
        mock_upsert: MagicMock,
        mock_generate: MagicMock,
    ) -> None:
        settings = make_settings()
        fresh_payload = {"class_summary": {"student_count": 5, "is_empty": False}}
        mock_generate.return_value = fresh_payload

        result = get_class_insights(settings, ClassInsightsRequest(
            user_id="teacher-1", class_id="class-1", force_refresh=True
        ))

        # Cache should not be checked when force_refresh=True
        mock_get_cache.assert_not_called()
        mock_generate.assert_called_once()
        mock_upsert.assert_called_once()
        self.assertEqual(result, fresh_payload)

    @patch("app.analytics._generate_insights_payload")
    @patch("app.analytics._upsert_snapshot")
    @patch("app.analytics._get_cached_snapshot")
    @patch("app.analytics._check_teacher_enrollment")
    def test_regenerates_when_cache_expired(
        self,
        mock_check: MagicMock,
        mock_get_cache: MagicMock,
        mock_upsert: MagicMock,
        mock_generate: MagicMock,
    ) -> None:
        settings = make_settings()
        # Cache returns None (expired)
        mock_get_cache.return_value = None
        fresh_payload = {"class_summary": {"student_count": 2, "is_empty": False}}
        mock_generate.return_value = fresh_payload

        result = get_class_insights(settings, ClassInsightsRequest(
            user_id="teacher-1", class_id="class-1", force_refresh=False
        ))

        mock_generate.assert_called_once()
        mock_upsert.assert_called_once()
        self.assertEqual(result, fresh_payload)


if __name__ == "__main__":
    unittest.main()
