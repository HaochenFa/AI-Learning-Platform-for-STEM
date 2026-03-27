from __future__ import annotations

import path_setup  # noqa: F401  # pyright: ignore[reportUnusedImport]

import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, call, patch

from app.analytics import (
    ClassInsightsRequest,
    ClassTeachingBriefRequest,
    _build_empty_payload,
    _check_teacher_enrollment,
    _get_cached_snapshot,
    _get_cached_teaching_brief_snapshot,
    _normalize_teaching_brief_payload,
    _upsert_teaching_brief_snapshot,
    _mark_teaching_brief_generating,
    compute_risk_level,
    compute_topic_status,
    format_display_name,
    get_class_insights,
    get_class_teaching_brief,
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


class NormalizeTeachingBriefPayloadTests(unittest.TestCase):
    def test_normalizes_mixed_llm_payload_shapes(self) -> None:
        payload = _normalize_teaching_brief_payload(
            {
                "summary": "  Students need another pass on force pairs. ",
                "strongest_action": " Re-model the interaction pair. ",
                "attention_items": [
                    {"topic": "Newton's Third Law", "detail": "Students swap action and reaction."},
                    "Net force language",
                ],
                "misconceptions": [
                    {"topic": "Newton's Third Law", "description": "They think bigger objects push harder."},
                ],
                "students_to_watch": [
                    {"student_id": "student-1", "reason": "Low completion this week."},
                ],
                "next_step": " Start with a hinge question. ",
                "recommended_activity": {
                    "type": "quiz",
                    "topic": "Newton's Third Law",
                    "reason": "Check whether the misconception is shrinking.",
                },
                "evidence_basis": " Recent quiz attempts and class chat transcripts. ",
            },
            topics_by_id={"topic-1": {"title": "Newton's Third Law"}},
            display_names={"student-1": "Alex P."},
        )

        self.assertEqual(
            payload["attention_items"],
            ["Newton's Third Law: Students swap action and reaction.", "Net force language"],
        )
        self.assertEqual(
            payload["misconceptions"],
            [
                {
                    "topic_id": "topic-1",
                    "topic_title": "Newton's Third Law",
                    "description": "They think bigger objects push harder.",
                }
            ],
        )
        self.assertEqual(
            payload["students_to_watch"],
            [
                {
                    "student_id": "student-1",
                    "display_name": "Alex P.",
                    "reason": "Low completion this week.",
                }
            ],
        )
        self.assertEqual(
            payload["recommended_activity"],
            {
                "type": "quiz",
                "reason": "Check whether the misconception is shrinking.",
            },
        )
        self.assertEqual(payload["summary"], "Students need another pass on force pairs.")
        self.assertEqual(payload["strongest_action"], "Re-model the interaction pair.")
        self.assertEqual(payload["next_step"], "Start with a hinge question.")
        self.assertEqual(payload["evidence_basis"], "Recent quiz attempts and class chat transcripts.")

    def test_raises_for_non_object_payload(self) -> None:
        with self.assertRaises(ValueError):
            _normalize_teaching_brief_payload([], topics_by_id={}, display_names={})

    def test_wraps_singleton_sections_before_normalizing(self) -> None:
        payload = _normalize_teaching_brief_payload(
            {
                "summary": "Brief",
                "strongest_action": "Act",
                "attention_items": "Net force language",
                "misconceptions": {
                    "topic": "Newton's Third Law",
                    "description": "Students think the larger object exerts the larger force.",
                },
                "students_to_watch": {
                    "student_id": "student-1",
                    "reason": "Needs follow-up on the exit ticket.",
                },
                "next_step": "Check understanding",
                "recommended_activity": {
                    "type": "exam_review",
                    "reason": "Target the misconception before the unit test.",
                },
                "evidence_basis": "Recent results",
            },
            topics_by_id={"topic-1": {"title": "Newton's Third Law"}},
            display_names={"student-1": "Alex P."},
        )

        self.assertEqual(payload["attention_items"], ["Net force language"])
        self.assertEqual(
            payload["misconceptions"],
            [
                {
                    "topic_id": "topic-1",
                    "topic_title": "Newton's Third Law",
                    "description": "Students think the larger object exerts the larger force.",
                }
            ],
        )
        self.assertEqual(
            payload["students_to_watch"],
            [
                {
                    "student_id": "student-1",
                    "display_name": "Alex P.",
                    "reason": "Needs follow-up on the exit ticket.",
                }
            ],
        )


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


class TeachingBriefSnapshotCacheTests(unittest.TestCase):
    """Tests for _get_cached_teaching_brief_snapshot — day-based freshness."""

    def test_returns_snapshot_when_generated_today(self) -> None:
        """Existing brief generated today (UTC) is returned as ready/fresh."""
        settings = make_settings()
        now = datetime.now(UTC)
        client = MagicMock()
        client.get.return_value = MagicMock(
            json=MagicMock(return_value=[{
                "payload": {"summary": "All good"},
                "generated_at": now.isoformat(),
                "status": "ready",
                "error_message": None,
            }])
        )
        result = _get_cached_teaching_brief_snapshot(client, settings, "class-1")
        self.assertIsNotNone(result)
        self.assertEqual(result["status"], "ready")
        self.assertFalse(result["is_stale"])
        self.assertEqual(result["payload"], {"summary": "All good"})

    def test_marks_stale_when_generated_yesterday(self) -> None:
        """Brief from yesterday is returned with is_stale=True."""
        settings = make_settings()
        yesterday = datetime.now(UTC) - timedelta(days=1)
        client = MagicMock()
        client.get.return_value = MagicMock(
            json=MagicMock(return_value=[{
                "payload": {"summary": "Old brief"},
                "generated_at": yesterday.isoformat(),
                "status": "ready",
                "error_message": None,
            }])
        )
        result = _get_cached_teaching_brief_snapshot(client, settings, "class-1")
        self.assertIsNotNone(result)
        self.assertTrue(result["is_stale"])
        self.assertEqual(result["payload"], {"summary": "Old brief"})

    def test_returns_none_when_no_rows(self) -> None:
        settings = make_settings()
        client = MagicMock()
        client.get.return_value = MagicMock(json=MagicMock(return_value=[]))
        result = _get_cached_teaching_brief_snapshot(client, settings, "class-1")
        self.assertIsNone(result)

    def test_preserves_generating_status(self) -> None:
        """When status is 'generating', return that status with old payload."""
        settings = make_settings()
        yesterday = datetime.now(UTC) - timedelta(days=1)
        client = MagicMock()
        client.get.return_value = MagicMock(
            json=MagicMock(return_value=[{
                "payload": {"summary": "Previous brief"},
                "generated_at": yesterday.isoformat(),
                "status": "generating",
                "error_message": None,
            }])
        )
        result = _get_cached_teaching_brief_snapshot(client, settings, "class-1")
        self.assertIsNotNone(result)
        self.assertEqual(result["status"], "generating")
        self.assertEqual(result["payload"], {"summary": "Previous brief"})

    def test_utc_boundary_just_after_midnight(self) -> None:
        """Brief generated just before UTC midnight is stale just after midnight."""
        settings = make_settings()
        # Simulate: generated at 23:59 yesterday UTC
        now = datetime.now(UTC)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        just_before_midnight = today_start - timedelta(seconds=60)
        client = MagicMock()
        client.get.return_value = MagicMock(
            json=MagicMock(return_value=[{
                "payload": {"summary": "Late night brief"},
                "generated_at": just_before_midnight.isoformat(),
                "status": "ready",
                "error_message": None,
            }])
        )
        result = _get_cached_teaching_brief_snapshot(client, settings, "class-1")
        self.assertIsNotNone(result)
        self.assertTrue(result["is_stale"])

    def test_utc_boundary_same_day_is_fresh(self) -> None:
        """Brief generated just after UTC midnight today is fresh."""
        settings = make_settings()
        now = datetime.now(UTC)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        just_after_midnight = today_start + timedelta(seconds=60)
        # Only test if we're past 00:01 UTC today to avoid edge case in test itself
        if now > just_after_midnight:
            client = MagicMock()
            client.get.return_value = MagicMock(
                json=MagicMock(return_value=[{
                    "payload": {"summary": "Early morning brief"},
                    "generated_at": just_after_midnight.isoformat(),
                    "status": "ready",
                    "error_message": None,
                }])
            )
            result = _get_cached_teaching_brief_snapshot(client, settings, "class-1")
            self.assertIsNotNone(result)
            self.assertFalse(result["is_stale"])


class TeachingBriefUpsertTests(unittest.TestCase):
    """Tests for _upsert_teaching_brief_snapshot."""

    def test_upsert_posts_correct_payload(self) -> None:
        settings = make_settings()
        client = MagicMock()
        client.post.return_value = MagicMock(status_code=200)
        _upsert_teaching_brief_snapshot(
            client, settings, "class-1", "ready", {"summary": "Test"}, None
        )
        client.post.assert_called_once()
        call_kwargs = client.post.call_args
        body = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json")
        self.assertEqual(body["class_id"], "class-1")
        self.assertEqual(body["status"], "ready")
        self.assertEqual(body["payload"], {"summary": "Test"})

    def test_upsert_with_error_message(self) -> None:
        settings = make_settings()
        client = MagicMock()
        client.post.return_value = MagicMock(status_code=200)
        _upsert_teaching_brief_snapshot(
            client, settings, "class-1", "error", None, "LLM call failed"
        )
        call_kwargs = client.post.call_args
        body = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json")
        self.assertEqual(body["status"], "error")
        self.assertEqual(body["error_message"], "LLM call failed")


class MarkTeachingBriefGeneratingTests(unittest.TestCase):
    """Tests for _mark_teaching_brief_generating — CAS guard."""

    def test_mark_generating_returns_true_when_not_already_generating(self) -> None:
        settings = make_settings()
        client = MagicMock()
        # Simulate successful PATCH (status 200, returned rows)
        client.patch.return_value = MagicMock(
            status_code=200,
            json=MagicMock(return_value=[{"id": "snap-1"}]),
        )
        result = _mark_teaching_brief_generating(client, settings, "class-1")
        self.assertTrue(result)

    def test_mark_generating_returns_false_when_already_generating(self) -> None:
        settings = make_settings()
        client = MagicMock()
        # Simulate no rows matched (already generating)
        client.patch.return_value = MagicMock(
            status_code=200,
            json=MagicMock(return_value=[]),
        )
        result = _mark_teaching_brief_generating(client, settings, "class-1")
        self.assertFalse(result)


class GetClassTeachingBriefTests(unittest.TestCase):
    """Tests for the main get_class_teaching_brief orchestrator."""

    @patch("app.analytics._generate_teaching_brief_payload")
    @patch("app.analytics._upsert_teaching_brief_snapshot")
    @patch("app.analytics._mark_teaching_brief_generating")
    @patch("app.analytics._get_cached_teaching_brief_snapshot")
    @patch("app.analytics._check_teacher_enrollment")
    def test_returns_ready_when_fresh_today(
        self,
        mock_check: MagicMock,
        mock_get_cache: MagicMock,
        mock_mark: MagicMock,
        mock_upsert: MagicMock,
        mock_generate: MagicMock,
    ) -> None:
        settings = make_settings()
        mock_get_cache.return_value = {
            "status": "ready",
            "is_stale": False,
            "payload": {"summary": "All good"},
            "generated_at": datetime.now(UTC).isoformat(),
            "has_evidence": True,
        }

        result = get_class_teaching_brief(settings, ClassTeachingBriefRequest(
            user_id="teacher-1", class_id="class-1", force_refresh=False,
        ))

        self.assertEqual(result["status"], "ready")
        self.assertFalse(result["is_stale"])
        self.assertEqual(result["payload"], {"summary": "All good"})
        mock_generate.assert_not_called()

    @patch("app.analytics._gather_teaching_brief_evidence")
    @patch("app.analytics._generate_teaching_brief_payload")
    @patch("app.analytics._upsert_teaching_brief_snapshot")
    @patch("app.analytics._mark_teaching_brief_generating")
    @patch("app.analytics._get_cached_teaching_brief_snapshot")
    @patch("app.analytics._check_teacher_enrollment")
    def test_returns_stale_payload_and_triggers_generation(
        self,
        mock_check: MagicMock,
        mock_get_cache: MagicMock,
        mock_mark: MagicMock,
        mock_upsert: MagicMock,
        mock_generate: MagicMock,
        mock_gather: MagicMock,
    ) -> None:
        settings = make_settings()
        yesterday = (datetime.now(UTC) - timedelta(days=1)).isoformat()
        mock_get_cache.return_value = {
            "status": "ready",
            "is_stale": True,
            "payload": {"summary": "Old brief"},
            "generated_at": yesterday,
            "has_evidence": True,
        }
        mock_mark.return_value = True
        mock_gather.return_value = {"has_evidence": True, "data": {}}
        mock_generate.return_value = {"summary": "New brief"}

        result = get_class_teaching_brief(settings, ClassTeachingBriefRequest(
            user_id="teacher-1", class_id="class-1", force_refresh=False,
        ))

        # Should return ready with new payload after regeneration
        self.assertEqual(result["status"], "ready")
        self.assertFalse(result["is_stale"])
        mock_generate.assert_called_once()
        mock_upsert.assert_called()

    @patch("app.analytics._generate_teaching_brief_payload")
    @patch("app.analytics._upsert_teaching_brief_snapshot")
    @patch("app.analytics._mark_teaching_brief_generating")
    @patch("app.analytics._get_cached_teaching_brief_snapshot")
    @patch("app.analytics._check_teacher_enrollment")
    def test_does_not_regenerate_same_day_fresh(
        self,
        mock_check: MagicMock,
        mock_get_cache: MagicMock,
        mock_mark: MagicMock,
        mock_upsert: MagicMock,
        mock_generate: MagicMock,
    ) -> None:
        """After same-day regeneration completed, should not auto-refresh again."""
        settings = make_settings()
        mock_get_cache.return_value = {
            "status": "ready",
            "is_stale": False,
            "payload": {"summary": "Fresh brief"},
            "generated_at": datetime.now(UTC).isoformat(),
            "has_evidence": True,
        }

        result = get_class_teaching_brief(settings, ClassTeachingBriefRequest(
            user_id="teacher-1", class_id="class-1", force_refresh=False,
        ))

        mock_generate.assert_not_called()
        mock_mark.assert_not_called()
        self.assertEqual(result["status"], "ready")

    @patch("app.analytics._gather_teaching_brief_evidence")
    @patch("app.analytics._generate_teaching_brief_payload")
    @patch("app.analytics._upsert_teaching_brief_snapshot")
    @patch("app.analytics._mark_teaching_brief_generating")
    @patch("app.analytics._get_cached_teaching_brief_snapshot")
    @patch("app.analytics._check_teacher_enrollment")
    def test_returns_no_data_when_no_evidence(
        self,
        mock_check: MagicMock,
        mock_get_cache: MagicMock,
        mock_mark: MagicMock,
        mock_upsert: MagicMock,
        mock_generate: MagicMock,
        mock_gather: MagicMock,
    ) -> None:
        """Returns no_data when there are no meaningful student activity signals."""
        settings = make_settings()
        mock_get_cache.return_value = None  # No snapshot exists
        mock_gather.return_value = {"has_evidence": False}

        result = get_class_teaching_brief(settings, ClassTeachingBriefRequest(
            user_id="teacher-1", class_id="class-1", force_refresh=False,
        ))

        self.assertEqual(result["status"], "no_data")
        self.assertFalse(result["has_evidence"])
        self.assertIsNone(result["payload"])
        mock_generate.assert_not_called()
        # Assert _upsert was called with status "no_data"
        mock_upsert.assert_called_once()
        upsert_call_args = mock_upsert.call_args
        # Verify status argument is "no_data"
        self.assertEqual(upsert_call_args[0][3], "no_data")

    @patch("app.analytics._gather_teaching_brief_evidence")
    @patch("app.analytics._generate_teaching_brief_payload")
    @patch("app.analytics._upsert_teaching_brief_snapshot")
    @patch("app.analytics._mark_teaching_brief_generating")
    @patch("app.analytics._get_cached_teaching_brief_snapshot")
    @patch("app.analytics._check_teacher_enrollment")
    def test_returns_empty_when_evidence_but_no_snapshot(
        self,
        mock_check: MagicMock,
        mock_get_cache: MagicMock,
        mock_mark: MagicMock,
        mock_upsert: MagicMock,
        mock_generate: MagicMock,
        mock_gather: MagicMock,
    ) -> None:
        """Returns empty when evidence exists but no brief has been generated yet (force_refresh=False)."""
        settings = make_settings()
        mock_get_cache.return_value = None  # No snapshot
        mock_gather.return_value = {"has_evidence": True, "data": {}}

        result = get_class_teaching_brief(settings, ClassTeachingBriefRequest(
            user_id="teacher-1", class_id="class-1", force_refresh=False,
        ))

        # Should NOT generate — just return the empty state so UI shows CTA
        mock_generate.assert_not_called()
        self.assertEqual(result["status"], "empty")
        self.assertTrue(result["has_evidence"])
        self.assertIsNone(result["payload"])
        self.assertIsNone(result["generated_at"])
        self.assertFalse(result["is_stale"])

    @patch("app.analytics._gather_teaching_brief_evidence")
    @patch("app.analytics._generate_teaching_brief_payload")
    @patch("app.analytics._upsert_teaching_brief_snapshot")
    @patch("app.analytics._mark_teaching_brief_generating")
    @patch("app.analytics._get_cached_teaching_brief_snapshot")
    @patch("app.analytics._check_teacher_enrollment")
    def test_generates_brief_on_first_force_refresh(
        self,
        mock_check: MagicMock,
        mock_get_cache: MagicMock,
        mock_mark: MagicMock,
        mock_upsert: MagicMock,
        mock_generate: MagicMock,
        mock_gather: MagicMock,
    ) -> None:
        """When force_refresh=True and no snapshot exists but evidence does, generate the brief."""
        settings = make_settings()
        mock_get_cache.return_value = None  # No snapshot yet
        mock_gather.return_value = {"has_evidence": True, "data": {}}
        mock_mark.return_value = True
        mock_generate.return_value = {"summary": "First brief"}

        result = get_class_teaching_brief(settings, ClassTeachingBriefRequest(
            user_id="teacher-1", class_id="class-1", force_refresh=True,
        ))

        mock_generate.assert_called_once()
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["payload"], {"summary": "First brief"})
        self.assertTrue(result["has_evidence"])
        self.assertFalse(result["is_stale"])
        mock_upsert.assert_called_once()

    @patch("app.analytics._generate_teaching_brief_payload")
    @patch("app.analytics._upsert_teaching_brief_snapshot")
    @patch("app.analytics._mark_teaching_brief_generating")
    @patch("app.analytics._get_cached_teaching_brief_snapshot")
    @patch("app.analytics._check_teacher_enrollment")
    def test_keeps_old_payload_during_concurrent_generation(
        self,
        mock_check: MagicMock,
        mock_get_cache: MagicMock,
        mock_mark: MagicMock,
        mock_upsert: MagicMock,
        mock_generate: MagicMock,
    ) -> None:
        """When status is already 'generating', reuse that state."""
        settings = make_settings()
        mock_get_cache.return_value = {
            "status": "generating",
            "is_stale": True,
            "payload": {"summary": "Previous brief"},
            "generated_at": (datetime.now(UTC) - timedelta(days=1)).isoformat(),
            "has_evidence": True,
        }

        result = get_class_teaching_brief(settings, ClassTeachingBriefRequest(
            user_id="teacher-1", class_id="class-1", force_refresh=False,
        ))

        self.assertEqual(result["status"], "generating")
        self.assertEqual(result["payload"], {"summary": "Previous brief"})
        mock_generate.assert_not_called()
        mock_mark.assert_not_called()

    @patch("app.analytics._gather_teaching_brief_evidence")
    @patch("app.analytics._generate_teaching_brief_payload")
    @patch("app.analytics._upsert_teaching_brief_snapshot")
    @patch("app.analytics._mark_teaching_brief_generating")
    @patch("app.analytics._get_cached_teaching_brief_snapshot")
    @patch("app.analytics._check_teacher_enrollment")
    def test_force_refresh_bypasses_freshness(
        self,
        mock_check: MagicMock,
        mock_get_cache: MagicMock,
        mock_mark: MagicMock,
        mock_upsert: MagicMock,
        mock_generate: MagicMock,
        mock_gather: MagicMock,
    ) -> None:
        """Force refresh ignores freshness and triggers regeneration."""
        settings = make_settings()
        mock_get_cache.return_value = {
            "status": "ready",
            "is_stale": False,
            "payload": {"summary": "Current brief"},
            "generated_at": datetime.now(UTC).isoformat(),
            "has_evidence": True,
        }
        mock_mark.return_value = True
        mock_gather.return_value = {"has_evidence": True, "data": {}}
        mock_generate.return_value = {"summary": "Force-refreshed brief"}

        result = get_class_teaching_brief(settings, ClassTeachingBriefRequest(
            user_id="teacher-1", class_id="class-1", force_refresh=True,
        ))

        mock_generate.assert_called_once()
        self.assertEqual(result["payload"], {"summary": "Force-refreshed brief"})

    @patch("app.analytics._get_cached_teaching_brief_snapshot")
    @patch("app.analytics._check_teacher_enrollment")
    def test_student_cannot_access_brief(
        self,
        mock_check: MagicMock,
        mock_get_cache: MagicMock,
    ) -> None:
        """Student/unauthorized actor cannot fetch teaching brief."""
        settings = make_settings()
        mock_check.side_effect = ClassDomainError(
            message="Only teachers and TAs can access class insights.",
            code="forbidden",
            status_code=403,
        )

        with self.assertRaises(ClassDomainError) as ctx:
            get_class_teaching_brief(settings, ClassTeachingBriefRequest(
                user_id="student-1", class_id="class-1",
            ))
        self.assertEqual(ctx.exception.status_code, 403)

    @patch("app.analytics._generate_teaching_brief_payload")
    @patch("app.analytics._upsert_teaching_brief_snapshot")
    @patch("app.analytics._mark_teaching_brief_generating")
    @patch("app.analytics._get_cached_teaching_brief_snapshot")
    @patch("app.analytics._check_teacher_enrollment")
    def test_stale_concurrent_mark_fails_skips_generation(
        self,
        mock_check: MagicMock,
        mock_get_cache: MagicMock,
        mock_mark: MagicMock,
        mock_upsert: MagicMock,
        mock_generate: MagicMock,
    ) -> None:
        """If CAS mark fails (another tab already generating), return stale payload."""
        settings = make_settings()
        yesterday = (datetime.now(UTC) - timedelta(days=1)).isoformat()
        mock_get_cache.return_value = {
            "status": "ready",
            "is_stale": True,
            "payload": {"summary": "Old brief"},
            "generated_at": yesterday,
            "has_evidence": True,
        }
        mock_mark.return_value = False  # CAS failed — already generating

        result = get_class_teaching_brief(settings, ClassTeachingBriefRequest(
            user_id="teacher-1", class_id="class-1", force_refresh=False,
        ))

        mock_generate.assert_not_called()
        self.assertEqual(result["status"], "generating")
        self.assertEqual(result["payload"], {"summary": "Old brief"})
        self.assertTrue(result["is_stale"])

    @patch("app.analytics._generate_teaching_brief_payload")
    @patch("app.analytics._upsert_teaching_brief_snapshot")
    @patch("app.analytics._mark_teaching_brief_generating")
    @patch("app.analytics._get_cached_teaching_brief_snapshot")
    @patch("app.analytics._check_teacher_enrollment")
    def test_error_preserves_old_payload_on_stale_regeneration(
        self,
        mock_check: MagicMock,
        mock_get_cache: MagicMock,
        mock_mark: MagicMock,
        mock_upsert: MagicMock,
        mock_generate: MagicMock,
    ) -> None:
        """When LLM generation fails on stale brief, preserve old payload and return error status."""
        settings = make_settings()
        yesterday = (datetime.now(UTC) - timedelta(days=1)).isoformat()
        old_payload = {"summary": "old brief"}
        mock_get_cache.return_value = {
            "status": "ready",
            "is_stale": True,
            "payload": old_payload,
            "generated_at": yesterday,
            "has_evidence": True,
        }
        mock_mark.return_value = True  # CAS succeeds
        mock_generate.side_effect = Exception("LLM call failed")

        result = get_class_teaching_brief(settings, ClassTeachingBriefRequest(
            user_id="teacher-1", class_id="class-1", force_refresh=False,
        ))

        # Assert result preserves old payload and has error status
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["payload"], old_payload)
        # Assert _upsert was called with error status and old payload
        mock_upsert.assert_called_once()
        upsert_call_args = mock_upsert.call_args
        # Status is the 4th argument (index 3)
        self.assertEqual(upsert_call_args[0][3], "error")
        # Payload is the 5th argument (index 4)
        self.assertEqual(upsert_call_args[0][4], old_payload)


if __name__ == "__main__":
    unittest.main()
