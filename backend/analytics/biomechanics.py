"""
SwingAI V3 — comprehensive biomechanical diagnostic matrix.

V4.1: 15 fault rules across five body groups (head/spine, shoulder/torso,
arms/wrists, hips/pelvis, legs/weight), layered on top of the V2 rules
(backswing sway, kinematic sequence) for a 17-rule suite. (Flat Shoulder Turn, Lead Arm Breakdown, and
Hanging Back were permanently removed — flawed math / false-positive prone.)

Every rule is SELF-CONTAINED (measured against the golfer's own address and
published biomechanical tolerances, never a reference swing), runs on
Savitzky-Golay-smoothed series, and is regression-tested to stay silent on
the clean tour-model swing.

Thresholds in inches are converted to normalized height units assuming a
70 in golfer (matching metrics.PLAYER_HEIGHT_IN).
"""

from __future__ import annotations

from typing import List, Tuple

import numpy as np

from .drills import Fault, PLAYER_HEIGHT_IN, SEVERITY_ORDER
from .dtw_aligner import SwingPhases
from .metrics import (
    LEFT_ANKLE, LEFT_ELBOW, LEFT_HEEL, LEFT_HIP, LEFT_INDEX, LEFT_KNEE,
    LEFT_PINKY, LEFT_SHOULDER, LEFT_THUMB, LEFT_WRIST, NOSE,
    RIGHT_ANKLE, RIGHT_ELBOW, RIGHT_HEEL, RIGHT_HIP, RIGHT_INDEX, RIGHT_KNEE,
    RIGHT_PINKY, RIGHT_SHOULDER, RIGHT_THUMB, RIGHT_WRIST,
    SwingMetrics, joint_angle_3d, kinematic_sequence_report, savgol_smooth,
)

IN = 1.0 / PLAYER_HEIGHT_IN  # one inch in normalized height units


def _sg(x: np.ndarray) -> np.ndarray:
    return savgol_smooth(np.asarray(x, dtype=np.float64))


def _mid(frames: np.ndarray, a: int, b: int) -> np.ndarray:
    return 0.5 * (frames[:, a, :3] + frames[:, b, :3])


def _signed_wrist_cock(frames: np.ndarray, lead: bool) -> np.ndarray:
    """
    Signed wrist-cock angle (degrees) between the forearm (elbow->wrist) and
    the hand/club assembly (wrist->hand centroid), sign from the 2-D cross
    product. Positive = cocked/lagged; negative = flipped past neutral.
    """
    el = LEFT_ELBOW if lead else RIGHT_ELBOW
    wr = LEFT_WRIST if lead else RIGHT_WRIST
    hands = (LEFT_PINKY, LEFT_INDEX, LEFT_THUMB) if lead else (RIGHT_PINKY, RIGHT_INDEX, RIGHT_THUMB)
    hand_mid = frames[:, hands, :3].mean(axis=1)
    forearm = frames[:, wr, :3] - frames[:, el, :3]
    club = hand_mid - frames[:, wr, :3]
    fa = _sg(forearm[:, 0]), _sg(forearm[:, 1])
    cl = _sg(club[:, 0]), _sg(club[:, 1])
    T = frames.shape[0]
    out = np.zeros(T)
    for t in range(T):
        f = np.array([fa[0][t], fa[1][t]])
        c = np.array([cl[0][t], cl[1][t]])
        nf, nc = np.linalg.norm(f), np.linalg.norm(c)
        if nf < 1e-9 or nc < 1e-9:
            continue
        cosv = float(np.clip(np.dot(f, c) / (nf * nc), -1, 1))
        ang = float(np.degrees(np.arccos(cosv)))
        cross = f[0] * c[1] - f[1] * c[0]
        out[t] = ang if cross >= 0 else -ang
    return out


def detect_faults(
    frames: np.ndarray,
    metrics: SwingMetrics,
    phases: SwingPhases,
    lead_side: str = "left",
) -> List[Fault]:
    """frames: NORMALIZED (T, 33, 4) array (+y up, pelvis-anchored, height units)."""
    faults: List[Fault] = []
    p = phases
    T = frames.shape[0]
    L = lead_side == "left"
    lead_sign = 1.0 if L else -1.0  # +x is toward target for a left-lead golfer

    def add(code: str, name: str, severity: str, phase: str,
            measured: float, target: float, unit: str, summary: str) -> None:
        faults.append(Fault(code=code, name=name, severity=severity, phase=phase,
                            measured=round(measured, 1), target=target, unit=unit,
                            summary=summary))

    head_x = _sg(frames[:, NOSE, 0]) * lead_sign
    head_y = _sg(frames[:, NOSE, 1])
    mid_hip = _mid(frames, LEFT_HIP, RIGHT_HIP)
    mid_sho = _mid(frames, LEFT_SHOULDER, RIGHT_SHOULDER)
    hip_x = _sg(mid_hip[:, 0]) * lead_sign
    sho_x = _sg(mid_sho[:, 0]) * lead_sign

    lead_ankle_x = float(frames[p.setup, LEFT_ANKLE if L else RIGHT_ANKLE, 0]) * lead_sign
    trail_ankle_x = float(frames[p.setup, RIGHT_ANKLE if L else LEFT_ANKLE, 0]) * lead_sign
    trail_heel_y = _sg(frames[:, RIGHT_HEEL if L else LEFT_HEEL, 1])
    lead_knee_x = _sg(frames[:, LEFT_KNEE if L else RIGHT_KNEE, 0]) * lead_sign

    mid_down = p.downswing
    down_lo, down_hi = p.top_of_backswing, p.impact + 1

    # ---------------- 1. HEAD & SPINE AXIS --------------------------------
    # 1) Head sway (address -> top) — loosened to 4.5 in AND required to be
    #    SUSTAINED (> 3 consecutive frames) so a single-frame landmark jump
    #    can never flag an athletic tour move.
    head_dev = np.abs(head_x[p.setup: p.top_of_backswing + 1] - head_x[p.setup]) / IN
    run = 0
    sustained = False
    for v in head_dev:
        run = run + 1 if v > 4.5 else 0
        if run > 3:
            sustained = True
            break
    sway_in = float(np.max(head_dev)) if len(head_dev) else 0.0
    if sustained:
        add("head_sway", "Head Sway", "major", "top_of_backswing", sway_in, 4.5, "in",
            f"Your head drifted {sway_in:.1f} in laterally between address and the top "
            "(tolerance ≤ 4.5 in, sustained). A stable head is the axis of the coil.")

    # 2) Early head lift (standing up before impact)
    lift_in = float(np.max(head_y[down_lo:down_hi]) - head_y[p.setup]) / IN
    if lift_in > 2.0:
        add("head_lift", "Early Head Lift", "minor", "downswing", lift_in, 2.0, "in",
            f"Your head rose {lift_in:.1f} in before impact (tolerance ≤ 2.0 in) — "
            "standing up early costs compression and low-point control.")

    # 3) Head dipping (downswing compression)
    dip_in = float(head_y[p.setup] - np.min(head_y[down_lo:down_hi])) / IN
    if dip_in > 3.0:
        add("head_dip", "Head Dipping", "minor", "downswing", dip_in, 3.0, "in",
            f"Your head dropped {dip_in:.1f} in during the downswing (tolerance ≤ 3.0 in) — "
            "excessive squat/dip makes strike depth unpredictable.")

    # 4) Loss of spine angle — the corrected retention delta from V2
    delta_imp = float(metrics.spine_delta_deg[p.impact])
    if delta_imp > 8.0:
        add("spine_retention", "Loss of Spine Angle", "minor", "downswing", delta_imp, 8.0, "deg",
            f"Your spine angle changed {delta_imp:.1f}° between address and impact "
            "(tolerance ≤ 8°).")

    # ---------------- 2. SHOULDER PLANE & TORSO ---------------------------
    # 6) Reverse spine angle (upper body leaning toward the target at the top)
    lean_in = ((sho_x[p.top_of_backswing] - hip_x[p.top_of_backswing])
               - (sho_x[p.setup] - hip_x[p.setup])) / IN
    if lean_in > 1.5:
        add("reverse_spine", "Reverse Spine Angle", "major", "top_of_backswing",
            lean_in, 1.5, "in",
            f"Your upper body tilted {lean_in:.1f} in TOWARD the target at the top "
            "(tolerance ≤ 1.5 in) — the classic reverse-pivot back-strain pattern.")

    # 7) Overswing
    rot_range = float(np.max(np.abs(metrics.shoulder_rotation_deg)))
    if rot_range > 125.0:
        add("overswing", "Overswing", "major", "top_of_backswing", rot_range, 125.0, "deg",
            f"Your shoulders turned {rot_range:.0f}° (tolerance ≤ 125°, camera-perspective safe) — past parallel "
            "the structure breaks down before the downswing even starts.")

    # 8) Lead shoulder snatch (shoulders fire before the hips in transition)
    sho_rot = np.asarray(metrics.shoulder_rotation_deg)
    hip_rot = np.asarray(metrics.hip_rotation_deg)
    sho_range = abs(float(sho_rot[p.impact] - sho_rot[p.top_of_backswing])) or 1e-9
    hip_range = abs(float(hip_rot[p.impact] - hip_rot[p.top_of_backswing])) or 1e-9
    snatch = False
    for t in range(p.top_of_backswing + 1, p.impact):
        sho_frac = abs(float(sho_rot[t] - sho_rot[p.top_of_backswing])) / sho_range
        hip_frac = abs(float(hip_rot[t] - hip_rot[p.top_of_backswing])) / hip_range
        if sho_frac >= 0.10:
            snatch = hip_frac < 0.02
            break
    if snatch:
        add("shoulder_snatch", "Lead Shoulder Snatch", "major", "downswing", 10.0, 2.0, "%",
            "Your shoulders started uncoiling before your hips moved — transition must "
            "sequence from the ground up (hips lead, shoulders follow).")

    # ---------------- 3. ARMS, WRISTS & LAG -------------------------------
    cock = _signed_wrist_cock(frames, L)
    # Polarity normalization: the wrist is maximally COCKED at the top, so the
    # sign of the cock there defines the "lagged" direction. This makes the
    # flip detector camera- and axis-convention independent.
    top_cock = float(np.mean(cock[max(0, p.top_of_backswing - 2): p.top_of_backswing + 3]))
    pol = 1.0 if top_cock >= 0 else -1.0
    cock = cock * pol
    wrist_angle = 180.0 - np.abs(cock)  # interior forearm-club angle

    # 9) Casting / early release — REFACTORED (V4.1):
    #    theta = arccos(v_forearm · v_hand / |v_forearm||v_hand|), evaluated
    #    ONLY between the top and mid-downswing (P5, shaft-parallel proxy) —
    #    never at the top itself or post-impact. Threshold 165° (= 15° grace
    #    below full extension) so normal tour uncocking passes untouched.
    #    GATE: if no wrist cock was ever measurable at the top (angle already
    #    near 180°, e.g. hand landmarks unresolved on real footage), the
    #    metric is meaningless and the rule stays silent — this is what fired
    #    a false 179.5° "cast" on tour benchmark video.
    # Hand-landmark resolution gate: if the hand centroid sits essentially ON
    # the wrist (< 1.2 in separation), the hand direction is tracking noise and
    # every wrist-angle metric is meaningless — casting AND flip stay silent.
    hands_idx = (LEFT_PINKY, LEFT_INDEX, LEFT_THUMB) if L else (RIGHT_PINKY, RIGHT_INDEX, RIGHT_THUMB)
    wr_idx = LEFT_WRIST if L else RIGHT_WRIST
    hand_sep = float(np.mean(np.linalg.norm(
        frames[:, hands_idx, :3].mean(axis=1) - frames[:, wr_idx, :3], axis=1)))
    hands_resolved = hand_sep > 1.2 * IN

    top_angle = float(np.mean(wrist_angle[max(0, p.top_of_backswing - 1): p.top_of_backswing + 2]))
    cast_win = wrist_angle[down_lo + 2: max(down_lo + 3, mid_down + 1)]
    cast_max = float(np.max(cast_win)) if len(cast_win) else 0.0
    if hands_resolved and top_angle < 150.0 and cast_max > 165.0:
        add("casting", "Casting / Early Release", "critical", "downswing", cast_max, 165.0, "deg",
            f"Your wrist angle opened to {cast_max:.0f}° before mid-downswing "
            "(hold ≤ 165° until the shaft reaches horizontal) — the lag you built "
            f"at the top ({top_angle:.0f}°) was thrown away in the first half of the downswing.")

    # 10) Chicken wing — V5 leniency: lead-elbow flex must exceed 52° AND
    #     persist for ≥ 3 consecutive frames post-impact. A single-frame
    #     landmark blip or a normal folding release can never trigger it.
    el = (LEFT_SHOULDER, LEFT_ELBOW, LEFT_WRIST) if L else (RIGHT_SHOULDER, RIGHT_ELBOW, RIGHT_WRIST)
    elbow_angle = _sg(np.array([
        joint_angle_3d(frames[t, el[0], :3], frames[t, el[1], :3], frames[t, el[2], :3])
        for t in range(T)
    ]))
    imp_win = elbow_angle[max(0, p.impact - 1): p.follow_through + 1]
    flex_series = 180.0 - imp_win
    run = 0
    wing_fired = False
    wing_peak = 0.0
    for v in flex_series:
        wing_peak = max(wing_peak, float(v))
        run = run + 1 if v > 52.0 else 0
        if run >= 3:
            wing_fired = True
    if wing_fired:
        add("chicken_wing", "Chicken Wing", "major", "impact", wing_peak, 52.0, "deg",
            f"Your lead elbow flexed {wing_peak:.0f}° through impact and held it for "
            "3+ frames (tolerance ≤ 52° sustained) — the elbow must extend down the "
            "target line, not break outward.")

    # 12) Flip / scoop at impact (wrist past neutral) — gated exactly like
    #     casting: only meaningful when a real wrist cock was measurable at
    #     the top; unresolved hand landmarks stay silent.
    flip_deg = float(np.min(cock[max(0, p.impact - 1): p.impact + 2]))
    if hands_resolved and top_angle < 150.0 and flip_deg < -10.0:
        add("flip_scoop", "Flip / Scoop at Impact", "critical", "impact",
            abs(flip_deg), 10.0, "deg",
            f"Your wrists flipped {abs(flip_deg):.0f}° past neutral at contact — dynamic "
            "loft is added instead of compressed; shaft must lean forward at strike.")

    # ---------------- 4. HIPS & PELVIS ------------------------------------
    # 13) Hip slide past the lead ankle in the downswing
    slide_in = (float(np.max(hip_x[down_lo:down_hi])) - lead_ankle_x) / IN
    if slide_in > 1.0:
        add("hip_slide", "Hip Slide", "major", "downswing", slide_in, 1.0, "in",
            f"Your pelvis slid {slide_in:.1f} in past your lead ankle (tolerance ≤ 1.0 in) — "
            "rotate around the lead hip socket instead of sliding through it.")

    # 14) Early extension (hip thrust toward the ball) — spec threshold 2.5 in
    thrust = np.asarray(metrics.hip_thrust)
    thrust_in = float(np.max(np.abs(thrust[down_lo:down_hi] - thrust[p.setup]))) * PLAYER_HEIGHT_IN
    spine_gain = float(metrics.spine_angle_deg[p.impact] - metrics.spine_angle_deg[p.top_of_backswing])
    if thrust_in > 2.5 or spine_gain > 8.0:
        add("early_extension", "Early Extension", "critical", "downswing",
            max(thrust_in, 0.0), 2.5, "in",
            f"Your hips moved {thrust_in:.1f} in toward the ball during the downswing "
            "(tolerance ≤ 2.5 in). This forces a stand-up delivery and blocks rotation.")

    # 15) Hip stall before impact
    hips_vel = np.asarray(metrics.kinematic_velocity["hips"])
    stall_lo = down_lo + int(0.6 * (p.impact - down_lo))
    down_peak = float(np.max(hips_vel[down_lo:down_hi])) or 1e-9
    stall_win = hips_vel[stall_lo: p.impact + 1]
    run = 0
    stalled = False
    for v in stall_win:
        run = run + 1 if v < 0.15 * down_peak else 0
        if run >= 3:
            stalled = True
            break
    if stalled:
        add("hip_stall", "Hip Stall", "minor", "downswing", 15.0, 15.0, "%",
            "Your pelvis rotation stalled before impact — when the engine stops, the "
            "hands must flip to square the face. Keep the hips turning through strike.")

    # ---------------- 5. LEGS, KNEES & WEIGHT -----------------------------
    # 16) Premature trail heel lift (before mid-downswing)
    heel_rise_in = (float(np.max(trail_heel_y[down_lo: mid_down + 1])) - float(trail_heel_y[p.setup])) / IN
    if heel_rise_in > 2.5:
        add("trail_heel_lift", "Premature Trail Heel Lift", "minor", "downswing",
            heel_rise_in, 2.5, "in",
            f"Your trail heel rose {heel_rise_in:.1f} in early in the downswing "
            "(tolerance ≤ 2.5 in) — stay grounded to keep pressure driving forward.")

    # 17) Lead knee collapse in the backswing (toward the trail leg)
    knee_win = lead_knee_x[p.setup: p.top_of_backswing + 1]
    collapse_in = (float(lead_knee_x[p.setup]) - float(np.min(knee_win))) / IN
    if collapse_in > 2.0:
        add("lead_knee_collapse", "Lead Knee Collapse", "major", "top_of_backswing",
            collapse_in, 2.0, "in",
            f"Your lead knee dove {collapse_in:.1f} in toward the trail leg in the backswing "
            "(tolerance ≤ 2.0 in) — keep its flex stable to preserve the lower-body coil.")

    # ---------------- V2 carry-overs --------------------------------------
    # Backswing sway (lateral drift away from target)
    hip_sway = np.asarray(metrics.hip_sway)
    sway_bw_in = -float(np.min(hip_sway[p.setup: p.top_of_backswing + 1])) * PLAYER_HEIGHT_IN
    if sway_bw_in > 2.5:
        add("sway", "Hip Sway (Backswing)", "major", "top_of_backswing", sway_bw_in, 2.5, "in",
            f"Your hips slid {sway_bw_in:.1f} in away from the target going back "
            "(tolerance ≤ 2.5 in) — coil into the trail hip, don't drift off the ball.")

    # Kinematic sequence
    seq = kinematic_sequence_report(metrics, p.top_of_backswing, p.impact)
    if not seq["sequence_correct"]:
        peaks = seq["peak_frames"]
        order_str = " → ".join(sorted(peaks, key=lambda k: peaks[k]))
        add("kinematic_sequence", "Kinematic Sequence Out of Order", "major", "downswing",
            0.0, 0.0, "order",
            f"Your peak-speed order was {order_str}; the efficient chain is "
            "hips → torso → arms → hands.")

    faults.sort(key=lambda f: SEVERITY_ORDER.get(f.severity, 9))
    return faults


def group_of(code: str) -> str:
    groups: List[Tuple[str, Tuple[str, ...]]] = [
        ("Head & Spine", ("head_sway", "head_lift", "head_dip", "spine_retention")),
        ("Shoulders & Torso", ("reverse_spine", "overswing", "shoulder_snatch")),
        ("Arms & Wrists", ("casting", "chicken_wing", "flip_scoop")),
        ("Hips & Pelvis", ("hip_slide", "early_extension", "hip_stall", "sway")),
        ("Legs & Weight", ("trail_heel_lift", "lead_knee_collapse")),
        ("Sequencing", ("kinematic_sequence",)),
    ]
    for name, codes in groups:
        if code in codes:
            return name
    return "Other"
