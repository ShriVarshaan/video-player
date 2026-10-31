import os
import time

from vp_sync.sync import clean_stale


def test_clean_stale_removes_old_leftovers_only(tmp_path):
    old = time.time() - 3600
    stale_dir = tmp_path / "vp-sync-abc"
    stale_dir.mkdir()
    (stale_dir / "audio.wav").write_bytes(b"x" * 10)
    stale_srt = tmp_path / "vp-autosync-123.srt"
    stale_srt.write_text("1")
    fresh_dir = tmp_path / "vp-sync-new"
    fresh_dir.mkdir()
    other = tmp_path / "someone-else.wav"
    other.write_text("keep")
    for p in (stale_dir, stale_srt, other):
        os.utime(p, (old, old))

    clean_stale(str(tmp_path))

    assert not stale_dir.exists()
    assert not stale_srt.exists()
    assert fresh_dir.exists()  # may belong to a sync running right now
    assert other.exists()
