"""
SwingAI — Dynamic Time Warping alignment + swing-phase segmentation.

Professionals and amateurs swing at completely different tempos, so a linear
time scale can never line up "top of backswing" with "top of backswing".
DTW warps the user's timeline non-linearly onto the pro's so every biomechanical
event is compared at the equivalent moment.

Implementation: classic O(N*M) dynamic-programming DTW with an optional
Sakoe-Chiba band, written directly in NumPy (no fastdtw dependency, exact
optimum, and trivially auditable).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np

from .metrics import (
    LEFT_WRIST,
    RIGHT_WRIST,
    SwingMetrics,
    midpoint_series,
    moving_average,
)

PHASE_NAMES = ["setup", "top_of_backswing", "downswing", "impact", "follow_through"]


# Core DTW
@dataclass
class DTWResult:
    path: List[Tuple[int, int]]      # monotonic warp path [(user_i, pro_j), ...]
    cost: float                      # total accumulated cost along the path
    normalized_cost: float           # cost / path length ("swing similarity")
    user_to_pro: np.ndarray          # (T_user,) best pro frame for each user frame
    pro_to_user: np.ndarray          # (T_pro,)  best user frame for each pro frame


def dtw_align(
    user_features: np.ndarray,
    pro_features: np.ndarray,
    band: Optional[int] = None,
) -> DTWResult:
    """
    user_features: (N, F) feature matrix (z-scored — see SwingMetrics.as_feature_matrix)
    pro_features:  (M, F) feature matrix
    band: Sakoe-Chiba band half-width in frames (None = unconstrained).

    Local cost: Euclidean distance between feature vectors.
    Recurrence:
        D[i, j] = d(i, j) + min(D[i-1, j], D[i, j-1], D[i-1, j-1])
    """
    a = np.asarray(user_features, dtype=np.float64)
    b = np.asarray(pro_features, dtype=np.float64)
    if a.ndim != 2 or b.ndim != 2 or a.shape[1] != b.shape[1]:
        raise ValueError(f"feature shape mismatch: {a.shape} vs {b.shape}")
    n, m = a.shape[0], b.shape[0]
    if n == 0 or m == 0:
        raise ValueError("empty sequence passed to dtw_align")

    # Pairwise local cost matrix, vectorized: |a_i - b_j|
    diff = a[:, None, :] - b[None, :, :]
    local = np.sqrt(np.einsum("ijk,ijk->ij", diff, diff))

    if band is not None:
        band = max(band, abs(n - m) + 1)  # band must admit the corner-to-corner path
        mask = np.full((n, m), np.inf)
        for i in range(n):
            j_center = int(round(i * (m - 1) / max(n - 1, 1)))
            lo, hi = max(0, j_center - band), min(m, j_center + band + 1)
            mask[i, lo:hi] = 0.0
        local = local + mask

    D = np.full((n + 1, m + 1), np.inf)
    D[0, 0] = 0.0
    for i in range(1, n + 1):
        # vectorized inner loop is possible but the explicit form keeps the
        # recurrence auditable; N*M for swing clips (~100x100) is negligible.
        for j in range(1, m + 1):
            c = local[i - 1, j - 1]
            if not np.isfinite(c):
                continue
            D[i, j] = c + min(D[i - 1, j], D[i, j - 1], D[i - 1, j - 1])

    if not np.isfinite(D[n, m]):
        raise RuntimeError("DTW band too narrow: no admissible path")

    # Backtrack
    path: List[Tuple[int, int]] = []
    i, j = n, m
    while i > 0 and j > 0:
        path.append((i - 1, j - 1))
        steps = ((D[i - 1, j - 1], i - 1, j - 1), (D[i - 1, j], i - 1, j), (D[i, j - 1], i, j - 1))
        _, i, j = min(steps, key=lambda s: s[0])
    path.reverse()

    user_to_pro = np.zeros(n, dtype=np.int64)
    pro_to_user = np.zeros(m, dtype=np.int64)
    for ui, pj in path:           # later entries overwrite -> keeps the LAST match,
        user_to_pro[ui] = pj      # both maps stay monotonic non-decreasing
    for ui, pj in path:
        pro_to_user[pj] = ui

    cost = float(D[n, m])
    return DTWResult(
        path=path,
        cost=cost,
        normalized_cost=cost / len(path),
        user_to_pro=user_to_pro,
        pro_to_user=pro_to_user,
    )


# Swing-phase segmentation
@dataclass
class SwingPhases:
    """Frame indices of the 5 critical checkpoints of one swing."""
    setup: int
    top_of_backswing: int
    downswing: int          # midpoint of the downswing move
    impact: int
    follow_through: int

    def as_dict(self) -> Dict[str, int]:
        return {
            "setup": self.setup,
            "top_of_backswing": self.top_of_backswing,
            "downswing": self.downswing,
            "impact": self.impact,
            "follow_through": self.follow_through,
        }


def segment_phases(frames: np.ndarray, lead_side: str = "left") -> SwingPhases:
    """
    Segment via the lead-wrist trajectory (normalized frames, +y up):

      setup            : first frame of the low-motion address period
      top_of_backswing : global max of wrist height BEFORE the speed peak
      impact           : frame of peak wrist speed at low wrist height
                         (club delivery) after the top
      downswing        : midpoint between top and impact
      follow_through   : first frame after impact where wrist speed decays
                         below 30% of its peak (or last frame)
    """
    wr = LEFT_WRIST if lead_side == "left" else RIGHT_WRIST
    T = frames.shape[0]
    if T < 10:
        raise ValueError("need at least 10 frames to segment a swing")

    wrist = frames[:, wr, :3]
    height = moving_average(wrist[:, 1], 5)
    speed = moving_average(np.linalg.norm(np.gradient(wrist, axis=0), axis=1), 5)

    peak_speed_frame = int(np.argmax(speed))
    peak_speed = float(speed[peak_speed_frame])

    # Top of backswing: highest wrist point before the speed peak.
    search_end = max(peak_speed_frame, 2)
    top = int(np.argmax(height[:search_end]))

    # Impact: within the post-top window, the frame where the wrist is back
    # down near its address height while speed is still >= 60% of peak.
    address_height = float(np.median(height[: max(2, T // 10)]))
    lo = top + 1
    hi = min(T, peak_speed_frame + max(3, T // 8) + 1)
    impact = peak_speed_frame
    best_score = np.inf
    for t in range(lo, hi):
        if speed[t] >= 0.6 * peak_speed:
            score = abs(float(height[t]) - address_height)
            if score < best_score:
                best_score = score
                impact = t
    impact = int(np.clip(impact, top + 1, T - 2))

    # Setup: end of initial stillness (speed under 15% of peak), capped pre-top.
    setup = 0
    for t in range(top):
        if speed[t] > 0.15 * peak_speed:
            break
        setup = t
    setup = int(min(setup, max(top - 1, 0)))

    # Follow-through: speed decays below 30% of peak after impact.
    follow = T - 1
    for t in range(impact + 1, T):
        if speed[t] < 0.3 * peak_speed:
            follow = t
            break

    downswing = int((top + impact) // 2)
    return SwingPhases(
        setup=setup,
        top_of_backswing=top,
        downswing=downswing,
        impact=impact,
        follow_through=int(follow),
    )


def phase_aligned_checkpoints(
    user_phases: SwingPhases,
    pro_phases: SwingPhases,
    dtw: DTWResult,
) -> Dict[str, Dict[str, int]]:
    """
    For each of the 5 phases, report the user's detected frame, the pro's
    detected frame, and where DTW says the user's frame lands on the pro's
    timeline — a large disagreement between the last two is itself a tempo
    diagnostic.
    """
    up, pp = user_phases.as_dict(), pro_phases.as_dict()
    out: Dict[str, Dict[str, int]] = {}
    for name in PHASE_NAMES:
        uf = int(np.clip(up[name], 0, len(dtw.user_to_pro) - 1))
        out[name] = {
            "user_frame": uf,
            "pro_frame": int(pp[name]),
            "dtw_mapped_pro_frame": int(dtw.user_to_pro[uf]),
        }
    return out


def align_swings(
    user_metrics: SwingMetrics,
    pro_metrics: SwingMetrics,
    band_fraction: float = 0.25,
) -> DTWResult:
    """Convenience wrapper: embed both swings and align with a proportional band."""
    uf = user_metrics.as_feature_matrix()
    pf = pro_metrics.as_feature_matrix()
    band = max(5, int(band_fraction * max(uf.shape[0], pf.shape[0])))
    return dtw_align(uf, pf, band=band)
