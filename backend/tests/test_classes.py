from __future__ import annotations

import path_setup  # noqa: F401  # pyright: ignore[reportUnusedImport]

import unittest
from unittest.mock import MagicMock, patch

from app.classes import (
    ClassDomainError,
    _escape_ilike_value,
    _extract_first_id,
    _extract_first_id_by_join_code,
    _is_unique_violation,
    create_class,
    join_class,
)
from app.schemas import ClassCreateRequest, ClassJoinRequest
from tests.helpers import make_settings


class ClassesTests(unittest.TestCase):
    def test_extract_first_id(self) -> None:
        self.assertEqual(_extract_first_id([{"id": "abc"}]), "abc")
        self.assertIsNone(_extract_first_id([]))

    def test_extract_first_id_by_join_code_uppercases_both_sides(self) -> None:
        payload = [
            {"id": "class-1", "join_code": "ab%_1"},
            {"id": "class-2", "join_code": "other"},
        ]
        self.assertEqual(
            _extract_first_id_by_join_code(payload, " AB%_1 "),
            "class-1",
        )
        self.assertIsNone(
            _extract_first_id_by_join_code(payload, " missing "),
        )

    def test_escape_ilike_value_escapes_like_wildcards(self) -> None:
        self.assertEqual(_escape_ilike_value(r"a\B%_1"), r"a\\B\%\_1")

    def test_is_unique_violation(self) -> None:
        self.assertTrue(_is_unique_violation({"code": "23505"}))
        self.assertTrue(_is_unique_violation(
            {"message": "duplicate key value"}))
        self.assertFalse(_is_unique_violation({"message": "other"}))

    def test_create_class_forbidden_for_non_teacher(self) -> None:
        settings = make_settings()
        request = ClassCreateRequest(
            user_id="u1", title="Physics", join_code="JOIN1")
        with patch("app.classes._load_account_type", return_value="student"):
            with self.assertRaises(ClassDomainError):
                create_class(settings, request)

    def test_join_class_forbidden_for_non_student(self) -> None:
        settings = make_settings()
        request = ClassJoinRequest(user_id="u1", join_code="JOIN1")
        with patch("app.classes._load_account_type", return_value="teacher"):
            with self.assertRaises(ClassDomainError):
                join_class(settings, request)

    def test_join_class_uses_case_insensitive_join_code_lookup(self) -> None:
        settings = make_settings()
        request = ClassJoinRequest(user_id="u1", join_code=" ab%_1 ")

        profile_response = MagicMock(status_code=200)
        profile_response.json.return_value = [{"account_type": "student"}]

        class_response = MagicMock(status_code=200)
        class_response.json.return_value = [{"id": "class-1", "join_code": "aB%_1"}]

        enrollment_response = MagicMock(status_code=201)
        enrollment_response.json.return_value = {}

        client = MagicMock()
        client.get.side_effect = [profile_response, class_response]
        client.post.return_value = enrollment_response

        client_context = MagicMock()
        client_context.__enter__.return_value = client
        client_context.__exit__.return_value = None

        with patch("app.classes.httpx.Client", return_value=client_context):
            result = join_class(settings, request)

        self.assertEqual(result.class_id, "class-1")
        lookup_url = client.get.call_args_list[1].args[0]
        self.assertIn("select=id,join_code", lookup_url)
        self.assertIn("join_code=ilike.AB%5C%25%5C_1", lookup_url)

    def test_create_class_reports_rollback_failure_when_delete_fails(self) -> None:
        settings = make_settings()
        request = ClassCreateRequest(
            user_id="teacher-1",
            title="Physics",
            subject="Science",
            level="College",
            description="Mechanics",
            join_code="JOIN42",
        )

        create_response = MagicMock(status_code=201)
        create_response.json.return_value = [{"id": "class-1"}]

        enrollment_response = MagicMock(status_code=400)
        enrollment_response.json.return_value = {"message": "Enrollment insert failed"}

        rollback_response = MagicMock(status_code=500)
        rollback_response.json.return_value = {"message": "Delete rollback failed"}

        client = MagicMock()
        client.post.side_effect = [create_response, enrollment_response]
        client.delete.return_value = rollback_response

        client_context = MagicMock()
        client_context.__enter__.return_value = client
        client_context.__exit__.return_value = None

        with (
            patch("app.classes.httpx.Client", return_value=client_context),
            patch("app.classes._load_account_type", return_value="teacher"),
        ):
            with self.assertRaises(RuntimeError) as ctx:
                create_class(settings, request)

        self.assertIn("Enrollment insert failed", str(ctx.exception))
        self.assertIn("Rollback failed: Delete rollback failed", str(ctx.exception))
        self.assertEqual(client.delete.call_count, 1)


if __name__ == "__main__":
    unittest.main()
