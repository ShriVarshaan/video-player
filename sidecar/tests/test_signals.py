import numpy as np

from vp_sync.signals import FRAME_S, cue_mask, enough_cues, score


def random_blocks(n_frames, seed):
    """On/off pattern like speech: blocks of 1–3 s with 1–5 s gaps."""
    r = np.random.default_rng(seed)
    m = np.zeros(n_frames, dtype=bool)
    t = int(r.integers(50, 300))
    while t < n_frames:
        on = int(r.integers(100, 300))
        m[t : t + on] = True
        t += on + int(r.integers(100, 500))
    return m


def test_cue_mask_applies_transform():
    m = cue_mask([(1.0, 2.0)], 1000, scale=2.0, offset=0.5)
    assert FRAME_S == 0.01
    assert not m[249] and m[250] and m[449] and not m[450]
    assert m.sum() == 200


def test_score_peaks_at_zero_when_aligned():
    speech = random_blocks(60_000, 1)
    z, peak = score(speech, speech.copy())
    assert peak == 0
    assert z > 10


def test_score_finds_the_shift():
    speech = random_blocks(60_000, 2)
    late = np.roll(speech, 300)  # the subtitle shows 3 s after the speech
    late[:300] = False
    z, peak = score(speech, late)
    assert peak == 300


def test_score_low_for_unrelated():
    z, _ = score(random_blocks(60_000, 3), random_blocks(60_000, 4))
    assert z < 5


def test_enough_cues():
    six = [(i * 5.0, i * 5.0 + 2) for i in range(6)]
    twenty = [(i * 5.0, i * 5.0 + 2) for i in range(20)]
    late = [(500 + i * 5.0, 502 + i * 5.0) for i in range(20)]
    assert not enough_cues(six, 300)
    assert enough_cues(twenty, 300)
    assert not enough_cues(late, 300)


def test_score_has_no_bias_toward_shift_zero():
    # Unrelated patterns: "as given" should stand out no more than any shift.
    zs = [score(random_blocks(60_000, 100 + i), random_blocks(60_000, 200 + i))[0] for i in range(20)]
    assert abs(float(np.mean(zs))) < 0.7
