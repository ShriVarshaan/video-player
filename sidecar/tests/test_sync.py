import json
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

import numpy as np
import pytest
import srt

from conftest import FFMPEG, MEDIA, ROOT, needs_media
from vp_sync.protocol import SyncError
from vp_sync.sync import run, snap_scale

pytestmark = needs_media
SIDECAR = ROOT / "sidecar"


def cues(path):
    with open(path, encoding="utf-8") as f:
        return [(c.start.total_seconds(), c.end.total_seconds()) for c in srt.parse(f.read())]


def params(sub, video="speech.mkv", **extra):
    return {"video": str(MEDIA / video), "subtitle": str(MEDIA / sub), "audioStream": 0, "durationS": 451.0, **extra}


def sync(sub, **kw):
    seen = []
    result = run(params(sub, **kw), lambda stage, pct: seen.append((stage, pct)), threading.Event())
    return result, seen


def errors_against_truth(sub, result):
    truth = [s for s, _ in cues(MEDIA / "speech.srt")]
    got = [result["scale"] * s + result["offset"] for s, _ in cues(MEDIA / sub)]
    return np.abs(np.array(got) - np.array(truth))


@pytest.mark.parametrize("variant", ["shift+3.2", "shift-7.5", "drift1001", "pal", "ntsc"])
def test_recovers(variant):
    sub = f"speech.{variant}.srt"
    result, _ = sync(sub)
    err = errors_against_truth(sub, result)
    print(f"{variant}: offset={result['offset']:.3f} scale={result['scale']:.6f} z={result['score']:.1f} median={np.median(err):.3f} p95={np.percentile(err, 95):.3f}")
    assert np.median(err) < 0.10
    assert np.percentile(err, 95) < 0.30
    if variant == "shift+3.2":
        assert result["offset"] == pytest.approx(-3.2, abs=0.1)  # the correction moves it earlier


def test_ground_truth_is_in_sync():
    result, _ = sync("speech.srt")
    assert abs(result["offset"]) < 0.05
    assert result["scale"] == 1.0


def test_wrong_subtitle_is_no_match():
    with pytest.raises(SyncError) as e:
        sync("speech.wrong.srt")
    assert e.value.code == "NO_MATCH"


def test_too_few_cues_is_no_match():
    with pytest.raises(SyncError) as e:
        sync("speech.few.srt")
    assert e.value.code == "NO_MATCH"


def test_no_audio():
    with pytest.raises(SyncError) as e:
        sync("speech.shift+3.2.srt", video="speech-noaudio.mkv")
    assert e.value.code == "NO_AUDIO"


def test_missing_video():
    with pytest.raises(SyncError) as e:
        sync("speech.shift+3.2.srt", video="does-not-exist.mkv")
    assert e.value.code == "FFMPEG_FAILED"


def test_progress_reports_audio_pct():
    _, seen = sync("speech.shift+3.2.srt")
    audio = [p for s, p in seen if s == "audio"]
    # The fixture decodes in a fraction of a second, so only a few reports come.
    assert audio[0] < 0.5 and audio[-1] == 1.0
    assert audio == sorted(audio)
    assert seen[-1] == ("match", None)


def test_cancel_stops_ffmpeg():
    cancelled = threading.Event()
    threading.Timer(0.3, cancelled.set).start()
    t0 = time.monotonic()
    with pytest.raises(SyncError) as e:
        run(params("speech.shift+3.2.srt"), lambda *a: None, cancelled)
    assert e.value.code == "CANCELLED"
    assert time.monotonic() - t0 < 1.3
    time.sleep(0.2)
    tasks = subprocess.run(["tasklist", "/FI", "IMAGENAME eq ffmpeg.exe"], capture_output=True, text=True).stdout
    assert str(FFMPEG.name) not in tasks


def test_sync_unicode_path(tmp_path):
    d = tmp_path / "Amélie dir"
    d.mkdir()
    shutil.copy(MEDIA / "speech.mkv", d / "Amélie (2001).mkv")
    shutil.copy(MEDIA / "speech.shift+3.2.srt", d / "Amélie (2001).en.srt")
    req = {"id": 1, "method": "sync", "params": {"video": str(d / "Amélie (2001).mkv"), "subtitle": str(d / "Amélie (2001).en.srt"), "audioStream": 0, "durationS": 451.0}}
    env = {**os.environ, "VP_FFMPEG": str(FFMPEG), "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
    p = subprocess.run(
        [sys.executable, "-m", "vp_sync"],
        input=(json.dumps(req, ensure_ascii=False) + "\n").encode("utf-8"),
        capture_output=True, cwd=SIDECAR, env=env, timeout=180,
    )
    lines = [json.loads(l) for l in p.stdout.decode("utf-8").splitlines() if l.strip()]
    final = lines[-1]
    assert "result" in final, final
    assert final["result"]["offset"] == pytest.approx(-3.2, abs=0.1)


def test_snap_scale():
    assert snap_scale(1.04271) == pytest.approx(25 / 23.976)
    assert snap_scale(1.0003) == 1.0
    assert snap_scale(1.02) == 1.02


BUILT = SIDECAR / "dist" / "vp-sync" / "vp-sync.exe"


@pytest.mark.skipif(not BUILT.exists(), reason="run `npm run build-sidecar` first")
def test_built_exe_syncs():
    req = {"id": 1, "method": "sync", "params": params("speech.shift+3.2.srt")}
    env = {**os.environ, "VP_FFMPEG": str(FFMPEG)}
    p = subprocess.run([str(BUILT)], input=(json.dumps(req) + "\n").encode("utf-8"), capture_output=True, env=env, timeout=180)
    lines = [json.loads(l) for l in p.stdout.decode("utf-8").splitlines() if l.strip()]
    assert any(l.get("event") == "progress" for l in lines)
    assert lines[-1]["result"]["offset"] == pytest.approx(-3.2, abs=0.1), p.stderr.decode("utf-8", "replace")[-2000:]


def test_audio_starting_after_the_video_keeps_its_delay(tmp_path):
    # Audio that starts 1.5 s into the file plays 1.5 s late in mpv: the
    # truth moved 1.5 s later is in sync with it, so the answer is ~0.
    late = tmp_path / "late.mkv"
    subprocess.run([str(FFMPEG), "-v", "error", "-y", "-i", str(MEDIA / "speech.mkv"), "-itsoffset", "1.5",
                    "-i", str(MEDIA / "speech.mkv"), "-map", "0:v", "-map", "1:a", "-c", "copy", str(late)], check=True)
    with open(MEDIA / "speech.srt", encoding="utf-8") as f:
        subs = list(srt.parse(f.read()))
    from datetime import timedelta
    for c in subs:
        c.start += timedelta(seconds=1.5)
        c.end += timedelta(seconds=1.5)
    sub = tmp_path / "late.srt"
    sub.write_text(srt.compose(subs), encoding="utf-8")
    result = run({"video": str(late), "subtitle": str(sub), "audioStream": 0, "durationS": 452.5}, lambda *a: None, threading.Event())
    assert abs(result["offset"]) < 0.1, result
