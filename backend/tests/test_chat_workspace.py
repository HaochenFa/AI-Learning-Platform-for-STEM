from __future__ import annotations

import path_setup  # noqa: F401  # pyright: ignore[reportUnusedImport]

import unittest

from app.chat_workspace import _decode_cursor, _encode_cursor, _normalize_messages_chronological


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


class CursorValidationTests(unittest.TestCase):
    def test_valid_cursor_round_trips(self) -> None:
        row = {
            "created_at": "2026-03-15T10:00:00.000000+00:00",
            "id": "550e8400-e29b-41d4-a716-446655440000",
        }
        cursor = _encode_cursor(row)
        assert cursor is not None
        decoded = _decode_cursor(cursor)
        self.assertIsNotNone(decoded)
        assert decoded is not None
        self.assertEqual(decoded["created_at"], row["created_at"])
        self.assertEqual(decoded["id"], row["id"])

    def test_malformed_id_rejected(self) -> None:
        # Cursor with valid-looking timestamp but injected text in id segment
        cursor = "2026-03-15T10:00:00+00:00|not-a-uuid),class_id.neq.x"
        self.assertIsNone(_decode_cursor(cursor))

    def test_malformed_timestamp_rejected(self) -> None:
        cursor = "not-a-timestamp|550e8400-e29b-41d4-a716-446655440000"
        self.assertIsNone(_decode_cursor(cursor))

    def test_empty_cursor_returns_none(self) -> None:
        self.assertIsNone(_decode_cursor(None))
        self.assertIsNone(_decode_cursor(""))
        self.assertIsNone(_decode_cursor("   "))

    def test_timestamp_with_injected_suffix_rejected(self) -> None:
        cursor = "2026-03-15T10:00:00),class_id.neq.x|550e8400-e29b-41d4-a716-446655440000"
        self.assertIsNone(_decode_cursor(cursor))
