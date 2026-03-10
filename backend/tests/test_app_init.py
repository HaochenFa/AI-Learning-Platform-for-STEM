from __future__ import annotations

import path_setup  # noqa: F401  # pyright: ignore[reportUnusedImport]

import unittest

import app


class AppInitTests(unittest.TestCase):
    def test_package_importable(self) -> None:
        self.assertTrue(hasattr(app, "__path__"))


if __name__ == "__main__":
    unittest.main()
