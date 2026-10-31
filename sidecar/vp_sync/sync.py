"""One auto sync: read the audio, ask ffsubsync for (offset, scale), check it.

Returns {"offset", "scale", "score"} with displayed = scale * t + offset, or
raises SyncError. Never writes next to the user's files: everything goes to a
temp folder that is removed afterwards.
"""

import contextlib
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import wave
from typing import Callable, List, Optional, Tuple

import numpy as np
import srt

from vp_sync.protocol import SyncError
from vp_sync.signals import FRAME_S, cue_mask, enough_cues, score, speech_mask

RATE = 16000
MAX_OFFSET_S = 120
# Beyond this the match sat at the edge of the search: not trusted.
EDGE_OFFSET_S = 115
# Correlation at the found alignment, in robust standard deviations above the
# median of all shifts. Set from the speech fixtures (see subtitle-sync-ml).
# Fixtures (2026-10-31): correct variants 13.3–13.9, wrong subtitle 3.7 → midway.
THRESHOLD = 8.5
# The found alignment must also be the best shift, within this many frames.
MAX_PEAK_FRAMES = 50
RATIOS = [1.0, 24 / 23.976, 23.976 / 24, 25 / 23.976, 23.976 / 25, 25 / 24, 24 / 25]

Progress = Callable[[str, Optional[float]], None]
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


STALE_S = 10 * 60


def clean_stale(tmp: Optional[str] = None) -> None:
    """Deletes leftovers of syncs that were killed mid-way (a WAV can be
    hundreds of MB). Recent ones are kept: they may belong to a running sync."""
    tmp = tmp or tempfile.gettempdir()
    cutoff = time.time() - STALE_S
    try:
        names = os.listdir(tmp)
    except OSError:
        return
    for name in names:
        path = os.path.join(tmp, name)
        try:
            if os.path.getmtime(path) > cutoff:
                continue
            if name.startswith("vp-sync-") and os.path.isdir(path):
                shutil.rmtree(path, ignore_errors=True)
            elif name.startswith("vp-autosync-") and name.endswith(".srt"):
                os.remove(path)
        except OSError:
            pass


def snap_scale(scale: float) -> float:
    for r in RATIOS:
        if abs(scale - r) <= 0.0005 * r:
            return r
    return scale


def _ffmpeg() -> str:
    path = os.environ.get("VP_FFMPEG")
    if not path or not os.path.exists(path):
        raise SyncError("FFMPEG_FAILED", "ffmpeg was not found (VP_FFMPEG)")
    return path


def _read_cues(path: str) -> List[Tuple[float, float]]:
    with open(path, encoding="utf-8-sig") as f:
        return [(c.start.total_seconds(), c.end.total_seconds()) for c in srt.parse(f.read())]


def _extract(ffmpeg: str, video: str, stream: int, out_wav: str, duration: Optional[float], progress: Progress, cancelled: threading.Event) -> None:
    # first_pts=0 pads an audio stream that starts after the file does, so the
    # WAV's time 0 is the film's time 0 (as mpv plays it).
    args = [ffmpeg, "-nostdin", "-v", "error", "-nostats", "-stats_period", "0.05", "-i", video, "-map", f"0:a:{stream}",
            "-af", "aresample=async=1:first_pts=0",
            "-ac", "1", "-ar", str(RATE), "-f", "wav", "-y", out_wav, "-progress", "pipe:1"]
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=NO_WINDOW)
    finished = threading.Event()

    def watch() -> None:
        while not finished.is_set():
            if cancelled.wait(0.05):
                proc.kill()
                return

    threading.Thread(target=watch, daemon=True).start()
    err: List[bytes] = []
    reader = threading.Thread(target=lambda: err.append(proc.stderr.read()), daemon=True)
    reader.start()
    last = -1.0
    try:
        for raw in proc.stdout:
            line = raw.decode("utf-8", "replace").strip()
            if line.startswith("out_time_us=") and duration:
                try:
                    pct = min(1.0, int(line.split("=", 1)[1]) / 1e6 / duration)
                except ValueError:
                    continue
                if pct >= last + 0.01:
                    last = pct
                    progress("audio", pct)
        proc.wait()
    finally:
        finished.set()
    reader.join()
    if cancelled.is_set():
        raise SyncError("CANCELLED", "cancelled")
    if proc.returncode != 0:
        text = (err[0] if err else b"").decode("utf-8", "replace")
        if "matches no streams" in text or "Stream map" in text:
            raise SyncError("NO_AUDIO", "this video has no audio track to sync to")
        raise SyncError("FFMPEG_FAILED", text.strip().splitlines()[-1] if text.strip() else "ffmpeg failed")
    progress("audio", 1.0)


def _read_wav(path: str) -> np.ndarray:
    with wave.open(path, "rb") as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)


def _ffsubsync(ffmpeg: str, wav: str, subtitle: str, out_srt: str) -> dict:
    from ffsubsync.ffsubsync import make_parser, run as ffs_run

    args = make_parser().parse_args([
        wav, "-i", subtitle, "-o", out_srt,
        "--max-offset-seconds", str(MAX_OFFSET_S), "--vad", "webrtc",
        "--ffmpeg-path", os.path.dirname(ffmpeg),
    ])
    # ffsubsync may print; stdout belongs to the protocol.
    with contextlib.redirect_stdout(sys.stderr):
        return ffs_run(args)


def run(params: dict, progress: Progress, cancelled: threading.Event) -> dict:
    ffmpeg = _ffmpeg()
    video, subtitle = params["video"], params["subtitle"]
    stream = int(params.get("audioStream") or 0)
    duration = params.get("durationS")
    try:
        cues = _read_cues(subtitle)
    except (OSError, ValueError, srt.SRTParseError) as e:
        raise SyncError("INTERNAL", f"could not read the subtitle: {e}")
    tmp = tempfile.mkdtemp(prefix="vp-sync-")
    try:
        wav = os.path.join(tmp, "audio.wav")
        _extract(ffmpeg, video, stream, wav, duration, progress, cancelled)
        progress("match", None)
        result = _ffsubsync(ffmpeg, wav, subtitle, os.path.join(tmp, "out.srt"))
        if cancelled.is_set():
            raise SyncError("CANCELLED", "cancelled")
        if not result.get("sync_was_successful") or result.get("offset_seconds") is None:
            raise SyncError("NO_MATCH", "the speech didn't line up with this subtitle")
        offset = float(result["offset_seconds"])
        scale = snap_scale(float(result.get("framerate_scale_factor") or 1.0))
        return _check(cues, _read_wav(wav), scale, offset)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _check(cues: List[Tuple[float, float]], pcm: np.ndarray, scale: float, offset: float) -> dict:
    duration = len(pcm) / RATE
    shown = [(scale * s + offset, scale * e + offset) for s, e in cues]
    if abs(offset) > EDGE_OFFSET_S or not enough_cues(shown, duration):
        raise SyncError("NO_MATCH", "not enough lines line up with the speech")
    speech = speech_mask(pcm, RATE)
    z, peak = score(speech, cue_mask(cues, len(speech), scale, offset), MAX_OFFSET_S)
    print(f"vp_sync: offset={offset:.3f} scale={scale:.6f} z={z:.2f} peak={peak}", file=sys.stderr)
    if z < THRESHOLD or abs(peak) > MAX_PEAK_FRAMES:
        raise SyncError("NO_MATCH", "the speech didn't line up with this subtitle")
    return {"offset": offset, "scale": scale, "score": z}
