import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
MEDIA = ROOT / "tests" / "fixtures" / "media"
FFMPEG = ROOT / "vendor" / "ffmpeg" / "ffmpeg.exe"

needs_media = pytest.mark.skipif(
    not (MEDIA / "speech.mkv").exists() or not FFMPEG.exists(),
    reason="run `npm run fetch-vendor` and `node scripts/make-fixtures.mjs` for the speech fixtures",
)


@pytest.fixture(autouse=True)
def _ffmpeg_env(monkeypatch):
    monkeypatch.setenv("VP_FFMPEG", str(FFMPEG))
