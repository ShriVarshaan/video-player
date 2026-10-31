"""Speech and subtitle on/off signals at 10 ms frames, and how well they line up."""

from typing import Sequence, Tuple

import numpy as np

FRAME_S = 0.01
MIN_CUES = 20


def cue_mask(cues: Sequence[Tuple[float, float]], n_frames: int, scale: float = 1.0, offset: float = 0.0) -> np.ndarray:
    """True for every frame a cue is shown, after displayed = scale * t + offset."""
    m = np.zeros(n_frames, dtype=bool)
    for start, end in cues:
        a = max(0, int(round((scale * start + offset) / FRAME_S)))
        b = min(n_frames, int(round((scale * end + offset) / FRAME_S)))
        if b > a:
            m[a:b] = True
    return m


def speech_mask(pcm: np.ndarray, rate: int = 16000, mode: int = 2) -> np.ndarray:
    """WebRTC voice activity per 10 ms frame of 16-bit mono PCM."""
    import webrtcvad

    vad = webrtcvad.Vad(mode)
    step = int(rate * FRAME_S)
    n = len(pcm) // step
    data = np.ascontiguousarray(pcm[: n * step], dtype=np.int16).tobytes()
    width = step * 2
    return np.fromiter((vad.is_speech(data[i * width : (i + 1) * width], rate) for i in range(n)), dtype=bool, count=n)


def score(speech: np.ndarray, subs: np.ndarray, max_shift_s: float = 120) -> Tuple[float, int]:
    """How far "as given" stands out among all shifts, and the best shift.

    Returns (z, peak): z is the correlation at shift 0 in robust standard
    deviations above the median over ±max_shift_s; peak is the shift in frames
    that correlates best, positive when the subtitle shows after the speech.
    """
    n = max(len(speech), len(subs))
    k = int(round(max_shift_s / FRAME_S))
    s = np.full(n, -1.0, dtype=np.float32)
    u = np.full(n, -1.0, dtype=np.float32)
    s[: len(speech)] = np.where(speech, 1.0, -1.0)
    u[: len(subs)] = np.where(subs, 1.0, -1.0)
    size = 1 << int(np.ceil(np.log2(n + k + 1)))
    # c[d] = Σ s[t]·u[t+d]: peaks at d when the subtitle runs d frames late.
    c = np.fft.irfft(np.conj(np.fft.rfft(s, size)) * np.fft.rfft(u, size), size)
    shifts = np.concatenate([np.arange(-k, 0), np.arange(0, k + 1)])
    corr = c[shifts % size]
    median = float(np.median(corr))
    mad = float(np.median(np.abs(corr - median))) or 1e-9
    z = (float(c[0]) - median) / (1.4826 * mad)
    return z, int(shifts[int(np.argmax(corr))])


def enough_cues(cues: Sequence[Tuple[float, float]], duration_s: float) -> bool:
    """Too few lines inside the audio can't be matched with any confidence."""
    return sum(1 for start, _ in cues if 0 <= start < duration_s) >= MIN_CUES
