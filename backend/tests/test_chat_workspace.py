from __future__ import annotations

import path_setup  # noqa: F401  # pyright: ignore[reportUnusedImport]

import unittest

from app.chat_workspace import _normalize_messages_chronological


class MessageOrderingTests(unittest.TestCase):
    def _make_pair(self, same_ts: bool) -> tuple[dict, dict]:
        user_ts = "2026-03-15T10:00:00.000000+00:00"
        # UUID chosen so "00000000..." < "ffffffff..." lexically —
        # with same timestamp the assistant would sort FIRST (wrong).
        user_row = {
            "id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
            "author_kind": "student",
            "content": "hello",
            "created_at": user_ts,
        }
        assistant_ts = user_ts if same_ts else "2026-03-15T10:00:00.001000+00:00"
        assistant_row = {
            "id": "00000000-0000-0000-0000-000000000000",
            "author_kind": "assistant",
            "content": "hi",
            "created_at": assistant_ts,
        }
        return user_row, assistant_row

    def test_same_timestamp_author_kind_tiebreaker_orders_correctly(self) -> None:
        """Verifies the author-kind tiebreaker ensures user-before-assistant ordering when timestamps are identical."""
        user_row, assistant_row = self._make_pair(same_ts=True)
        result = _normalize_messages_chronological([assistant_row, user_row])
        # "00000000..." < "ffffffff..." so assistant sorts FIRST — this FAILS before fix
        self.assertEqual(result[0]["author_kind"], "student")
        self.assertEqual(result[1]["author_kind"], "assistant")

    def test_offset_timestamp_orders_user_before_assistant(self) -> None:
        """With +1ms offset, user always comes before assistant regardless of UUID."""
        user_row, assistant_row = self._make_pair(same_ts=False)
        result = _normalize_messages_chronological([assistant_row, user_row])
        self.assertEqual(result[0]["author_kind"], "student")
        self.assertEqual(result[1]["author_kind"], "assistant")
