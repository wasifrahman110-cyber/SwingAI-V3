"""
Engine sanity tests: synthetic pro + faulty user swing through the full pipeline.

Run:  python -m tests.test_engine   (from /backend)
"""

from __future__ import annotations

import math
import sys

import numpy as np

from analytics import metrics as M
from analytics.dtw_aligner import align_swings, dtw_align, segment_phases
from analytics.biomechanics import detect_faults
from analytics.drills import recommend_drills
from analytics.metrics import PoseNormalizer, compute_metrics, deviation_matrix


def synth_swing(
    frames: int = 90,
    tempo: float = 1.0,
    early_extension: float = 0.0,
    chicken_wing: float = 0.0,
    sway: float = 0.0,
    seed: int = 7,
) -> np.ndarray:
    """
    Parametric 33-landmark golf swing in raw MediaPipe-style screen coords
    (+y DOWN, origin top-left, roughly unit-box). Fault magnitudes are in
    normalized body units.
    """
    rng = np.random.default_rng(seed)
    T = frames
    out = np.zeros((T, 33, 4))
    out[:, :, 3] = 1.0

    # swing phase parameter s in [0, 1]: 0 address, 0.55 top, 0.8 impact, 1 finish
    s = (np.linspace(0, 1, T)) ** tempo

    def backswing_amt(si: float) -> float:
        # 0 at address -> 1 at top (si=0.55) -> back through 0 at impact (si=0.8) -> -0.6 finish
        if si < 0.55:
            return math.sin(si / 0.55 * math.pi / 2)
        if si < 0.8:
            return math.cos((si - 0.55) / 0.25 * math.pi / 2)
        return -0.6 * math.sin((si - 0.8) / 0.2 * math.pi / 2)

    for t in range(T):
        si = float(s[t])
        b = backswing_amt(si)                      # 1 = full backswing, negative = release side
        down = max(0.0, (si - 0.55) / 0.45)        # 0 until top, 1 at finish
        hip_cx = 0.5 - sway * max(0.0, b) * 0.5 + 0.02 * down  # + weight shift toward target
        hip_cy = 0.62
        hip_cz = -early_extension * down           # thrust toward camera in downswing
        hip_half = 0.055
        rot = b * 0.35                             # pelvis rotation proxy (z offset of hip ends)

        out[t, M.LEFT_HIP, :3] = (hip_cx + hip_half, hip_cy, hip_cz + rot * hip_half)
        out[t, M.RIGHT_HIP, :3] = (hip_cx - hip_half, hip_cy, hip_cz - rot * hip_half)

        sho_cy = hip_cy - 0.19
        sho_half = 0.075
        srot = b * 0.7
        tilt = 0.065 * b                           # shoulder-plane tilt (lead shoulder works down)
        out[t, M.LEFT_SHOULDER, :3] = (hip_cx + sho_half, sho_cy + tilt, hip_cz + srot * sho_half)
        out[t, M.RIGHT_SHOULDER, :3] = (hip_cx - sho_half, sho_cy - tilt, hip_cz - srot * sho_half)

        out[t, M.NOSE, :3] = (hip_cx, sho_cy - 0.085, hip_cz)
        for eye, dx in ((M.LEFT_EYE, 0.012), (M.RIGHT_EYE, -0.012)):
            out[t, eye, :3] = (hip_cx + dx, sho_cy - 0.09, hip_cz)

        # Lead (left) arm swings on an arc; wing bends the elbow post-impact.
        arm_len = 0.16
        theta = 0.35 + b * 1.9                     # arm angle from straight-down
        wing = chicken_wing * max(0.0, (si - 0.75) / 0.25)
        sx, sy = out[t, M.LEFT_SHOULDER, 0], out[t, M.LEFT_SHOULDER, 1]
        arm_z = float(out[t, M.LEFT_SHOULDER, 2])  # whole arm rides the torso's z-plane
        ex = sx + arm_len * math.sin(theta)
        ey = sy + arm_len * math.cos(theta)
        out[t, M.LEFT_ELBOW, :3] = (ex, ey, arm_z)
        wx = ex + arm_len * math.sin(theta - wing * 1.2)
        wy = ey + arm_len * math.cos(theta - wing * 1.2) - wing * 0.05
        out[t, M.LEFT_WRIST, :3] = (wx, wy, arm_z)
        # trail arm mirrors loosely
        trail_z = float(out[t, M.RIGHT_SHOULDER, 2])
        out[t, M.RIGHT_ELBOW, :3] = (2 * hip_cx - ex, ey, trail_z)
        out[t, M.RIGHT_WRIST, :3] = (2 * hip_cx - wx, wy, trail_z)

        # Wrist cock: hinge ~52 deg back, HOLD lag to 60% of downswing, release.
        if si < 0.55:
            cock = 0.9 * math.sin(si / 0.55 * math.pi / 2)
        elif si < 0.7:
            cock = 0.9
        elif si < 0.82:
            cock = 0.9 * (1 - (si - 0.7) / 0.12)
        else:
            cock = 0.0
        fxv, fyv = wx - ex, wy - ey
        fn = math.hypot(fxv, fyv) or 1e-6
        hdx = (fxv / fn) * math.cos(cock) - (fyv / fn) * math.sin(cock)
        hdy = (fxv / fn) * math.sin(cock) + (fyv / fn) * math.cos(cock)
        hand_len = 0.035
        for h_lm, off in ((M.LEFT_PINKY, 1.0), (M.LEFT_INDEX, 1.15), (M.LEFT_THUMB, 0.85)):
            out[t, h_lm, :3] = (wx + hdx * hand_len * off, wy + hdy * hand_len * off, arm_z)
        for h_lm, off in ((M.RIGHT_PINKY, 1.0), (M.RIGHT_INDEX, 1.15), (M.RIGHT_THUMB, 0.85)):
            out[t, h_lm, :3] = (2 * hip_cx - (wx + hdx * hand_len * off), wy + hdy * hand_len * off, trail_z)

        # Legs: knees flex slightly; trail heel releases only AFTER impact.
        for hip, knee, ankle, heel, toe in (
            (M.LEFT_HIP, M.LEFT_KNEE, M.LEFT_ANKLE, M.LEFT_HEEL, M.LEFT_FOOT_INDEX),
            (M.RIGHT_HIP, M.RIGHT_KNEE, M.RIGHT_ANKLE, M.RIGHT_HEEL, M.RIGHT_FOOT_INDEX),
        ):
            hx, hy = out[t, hip, 0], out[t, hip, 1]
            out[t, knee, :3] = (hx, hy + 0.13, hip_cz * 0.5)
            is_lead = hip == M.LEFT_HIP
            base_x = 0.5 + (hip_half if is_lead else -hip_half)
            heel_rise = 0.0 if is_lead else max(0.0, si - 0.82) * 0.18
            out[t, ankle, :3] = (base_x, hy + 0.26 - heel_rise * 0.5, 0.0)
            out[t, heel, :3] = (base_x - 0.01, hy + 0.27 - heel_rise, 0.0)
            out[t, toe, :3] = (base_x + 0.02, hy + 0.27, 0.02)

        for lm in (M.LEFT_EAR, M.RIGHT_EAR, M.MOUTH_LEFT, M.MOUTH_RIGHT,
                   M.LEFT_EYE_INNER, M.LEFT_EYE_OUTER, M.RIGHT_EYE_INNER, M.RIGHT_EYE_OUTER):
            out[t, lm, :3] = out[t, M.NOSE, :3] + rng.normal(0, 0.002, 3)

    out[:, :, :3] += rng.normal(0, 0.0015, (T, 33, 3))  # sensor noise
    return out


def check(name: str, cond: bool) -> bool:
    print(("PASS " if cond else "FAIL ") + name)
    return cond


def main() -> int:
    ok = True

    # --- vector math primitives ---
    ok &= check("angle_between orthogonal = 90",
                abs(M.angle_between(np.array([1, 0, 0]), np.array([0, 1, 0])) - 90) < 1e-9)
    ok &= check("angle_between parallel = 0",
                abs(M.angle_between(np.array([2, 0, 0]), np.array([5, 0, 0]))) < 1e-9)
    ok &= check("joint_angle straight = 180",
                abs(M.joint_angle_3d(np.array([0, 0, 0.0]), np.array([1, 0, 0.0]), np.array([2, 0, 0.0])) - 180) < 1e-9)
    ok &= check("degenerate vector angle = 0",
                M.angle_between(np.zeros(3), np.array([1.0, 0, 0])) == 0.0)

    # --- DTW identity & shift ---
    seq = np.sin(np.linspace(0, 3 * np.pi, 60))[:, None]
    r = dtw_align(seq, seq)
    ok &= check("DTW self-alignment cost ~ 0", r.cost < 1e-9)
    ok &= check("DTW self path is diagonal", all(i == j for i, j in r.path))
    slow = np.sin(np.linspace(0, 3 * np.pi, 90))[:, None]
    r2 = dtw_align(slow, seq, band=40)
    ok &= check("DTW tempo warp aligns endpoints",
                r2.path[0] == (0, 0) and r2.path[-1] == (89, 59))
    ok &= check("DTW maps are monotonic",
                bool(np.all(np.diff(r2.user_to_pro) >= 0) and np.all(np.diff(r2.pro_to_user) >= 0)))

    # --- full pipeline ---
    pro_raw = synth_swing(frames=75, tempo=1.0, seed=3)
    usr_raw = synth_swing(frames=95, tempo=1.25, early_extension=0.09,
                          chicken_wing=0.9, sway=0.16, seed=11)

    norm = PoseNormalizer()
    pro_n = norm.normalize(pro_raw)
    usr_n = norm.normalize(usr_raw)
    ok &= check("normalization flips y up (head above pelvis)",
                usr_n.frames[0, M.NOSE, 1] > 0)
    ok &= check("normalization centers setup pelvis near origin",
                float(np.linalg.norm(usr_n.frames[0, M.LEFT_HIP, :3] + usr_n.frames[0, M.RIGHT_HIP, :3]) / 2) < 0.1)

    pro_m = compute_metrics(pro_n.frames)
    usr_m = compute_metrics(usr_n.frames)
    pro_ph = segment_phases(pro_n.frames)
    usr_ph = segment_phases(usr_n.frames)
    ok &= check("phase ordering (pro)",
                pro_ph.setup <= pro_ph.top_of_backswing < pro_ph.downswing <= pro_ph.impact <= pro_ph.follow_through)
    ok &= check("phase ordering (user)",
                usr_ph.setup <= usr_ph.top_of_backswing < usr_ph.downswing <= usr_ph.impact <= usr_ph.follow_through)

    dtw = align_swings(usr_m, pro_m)
    ok &= check("pipeline DTW path covers both swings",
                dtw.path[0] == (0, 0) and dtw.path[-1] == (94, 74))
    devs = deviation_matrix(usr_m, pro_m, dtw.path)
    ok &= check("deviation matrix length == path length", len(devs) == len(dtw.path))

    faults = detect_faults(usr_n.frames, usr_m, usr_ph)
    codes = {f.code for f in faults}
    ok &= check(f"early extension detected ({codes})", "early_extension" in codes)
    ok &= check("chicken wing detected", "chicken_wing" in codes)
    ok &= check("sway detected", "sway" in codes)

    clean = detect_faults(pro_n.frames, pro_m, pro_ph)
    clean_codes = {f.code for f in clean}
    ok &= check(f"clean swing triggers ZERO of the 20 fault rules ({clean_codes or 'none'})",
                len(clean_codes) == 0)

    # --- V2 regression: spine retention must track DELTA from address -----
    # A golfer holding a constant 30-deg forward bend all swing has perfect
    # retention; the V1 bug scored the raw global angle and flagged them.
    bent = pro_raw.copy()
    # tip the whole upper body forward by shifting shoulders/head in z
    for lm in (M.LEFT_SHOULDER, M.RIGHT_SHOULDER, M.NOSE, M.LEFT_EYE, M.RIGHT_EYE):
        bent[:, lm, 2] += 0.12
    bent_m = compute_metrics(norm.normalize(bent).frames)
    bent_ph = segment_phases(norm.normalize(bent).frames)
    ok &= check("constant forward bend -> tiny spine delta at impact",
                float(bent_m.spine_delta_deg[bent_ph.impact]) < 8.0)
    bent_n = norm.normalize(bent)
    ok &= check("bent-over clean swing not flagged for spine retention",
                "spine_retention" not in {f.code for f in detect_faults(bent_n.frames, bent_m, bent_ph)})

    # --- V2 regression: landmark jitter must not break the kinematic order --
    from analytics.metrics import kinematic_sequence_report
    noisy = pro_raw + np.random.default_rng(99).normal(0, 0.004, pro_raw.shape)
    noisy[:, :, 3] = 1.0
    noisy_m = compute_metrics(norm.normalize(noisy).frames)
    noisy_ph = segment_phases(norm.normalize(noisy).frames)
    seq_clean = kinematic_sequence_report(pro_m, pro_ph.top_of_backswing, pro_ph.impact)
    seq_noisy = kinematic_sequence_report(noisy_m, noisy_ph.top_of_backswing, noisy_ph.impact)
    ok &= check("kinematic verdict stable under 3x sensor noise",
                seq_clean["sequence_correct"] == seq_noisy["sequence_correct"])
    ok &= check("kinematic peaks confined to downswing window",
                all(seq_noisy["window"]["start"] <= f <= seq_noisy["window"]["end"]
                    for f in seq_noisy["peak_frames"].values()))

    drills = recommend_drills(faults)
    ok &= check("every fault maps to a drill card", len(drills) == len(faults))
    ok &= check("drill markdown carries targets",
                all("Target:" in d.markdown and "Yours:" in d.markdown for d in drills))

    print("\n" + ("ALL TESTS PASSED" if ok else "TESTS FAILED"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
