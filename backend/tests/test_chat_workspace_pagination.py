from __future__ import annotations

import path_setup  # noqa: F401  # pyright: ignore[reportUnusedImport]

import unittest
from contextlib import nullcontext
from unittest.mock import patch

from app.chat_workspace import ChatWorkspaceError, list_messages
from app.schemas import ChatWorkspaceMessagesListRequest
from tests.helpers import make_settings


class ChatWorkspacePaginationTests(unittest.TestCase):
    def test_list_messages_wraps_or_filter_for_before_cursor(self) -> None:
        settings = make_settings()
        cursor = "2026-03-10T00:00:00+00:00|550e8400-e29b-41d4-a716-446655440000"
        request = ChatWorkspaceMessagesListRequest(
            class_id="class-1",
            user_id="teacher-1",
            session_id="session-1",
            owner_user_id="student-1",
            before_cursor=cursor,
            limit=20,
        )

        session_row = {
            "id": "session-1",
            "class_id": "class-1",
            "owner_user_id": "student-1",
            "title": "Session",
            "is_pinned": False,
            "archived_at": None,
            "last_message_at": "2026-03-10T00:10:00+00:00",
            "created_at": "2026-03-10T00:00:00+00:00",
            "updated_at": "2026-03-10T00:10:00+00:00",
        }

        with (
            patch("app.chat_workspace._client", return_value=nullcontext(object())),
            patch("app.chat_workspace._resolve_access", return_value={"is_member": True, "is_teacher": True}),
            patch("app.chat_workspace._resolve_owner_user_id", return_value="student-1"),
            patch("app.chat_workspace._query_maybe_single", return_value=session_row),
            patch("app.chat_workspace._query_list", return_value=[]) as query_list_mock,
        ):
            list_messages(settings, request)

        params = query_list_mock.call_args.kwargs["params"]
        self.assertEqual(
            params["or"],
            "(created_at.lt.2026-03-10T00:00:00+00:00,and(created_at.eq.2026-03-10T00:00:00+00:00,id.lt.550e8400-e29b-41d4-a716-446655440000))",
        )

    def test_list_messages_raises_400_on_invalid_cursor(self) -> None:
        """A non-empty before_cursor that fails format validation must raise 400
        rather than silently falling back to the first page."""
        settings = make_settings()
        request = ChatWorkspaceMessagesListRequest(
            class_id="class-1",
            user_id="student-1",
            session_id="session-1",
            before_cursor="not-a-valid-cursor",
        )
        session_row = {
            "id": "session-1",
            "class_id": "class-1",
            "owner_user_id": "student-1",
            "title": "Session",
            "is_pinned": False,
            "archived_at": None,
            "last_message_at": "2026-03-10T00:10:00+00:00",
            "created_at": "2026-03-10T00:00:00+00:00",
            "updated_at": "2026-03-10T00:10:00+00:00",
        }

        with (
            patch("app.chat_workspace._client", return_value=nullcontext(object())),
            patch("app.chat_workspace._resolve_access", return_value={"is_member": True, "is_teacher": False}),
            patch("app.chat_workspace._resolve_owner_user_id", return_value="student-1"),
            patch("app.chat_workspace._query_maybe_single", return_value=session_row),
        ):
            with self.assertRaises(ChatWorkspaceError) as ctx:
                list_messages(settings, request)

        self.assertEqual(ctx.exception.code, "invalid_cursor")
        self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
