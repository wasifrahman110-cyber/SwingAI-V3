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

IN = 1.0 / PLAYER_HEIGHT_IN


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
    fa = (
        savgol_smooth(np.asarray(forearm[:, 0], dtype=np.float64)),
        savgol_smooth(np.asarray(forearm[:, 1], dtype=np.float64)),
    )
    cl = (
        savgol_smooth(np.asarray(club[:, 0], dtype=np.float64)),
        savgol_smooth(np.asarray(club[:, 1], dtype=np.float64)),
    )
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
    faults: List[Fault] = []
    p = phases
    T = frames.shape[0]
    is_lead_left = lead_side == "left"
    if is_lead_left:
        lead_sign = 1.0
    else:
        lead_sign = -1.0

    def append_fault(code: str, name: str, severity: str, phase: str,
                      measured: float, target: float, unit: str, summary: str) -> None:
        faults.append(Fault(code=code, name=name, severity=severity, phase=phase,
                            measured=round(measured, 1), target=target, unit=unit,
                            summary=summary))

    nose_x = savgol_smooth(np.asarray(frames[:, NOSE, 0], dtype=np.float64)) * lead_sign
    nose_y = savgol_smooth(np.asarray(frames[:, NOSE, 1], dtype=np.float64))
    hip_mid = 0.5 * (frames[:, LEFT_HIP, :3] + frames[:, RIGHT_HIP, :3])
    sho_mid = 0.5 * (frames[:, LEFT_SHOULDER, :3] + frames[:, RIGHT_SHOULDER, :3])
    pelvis_x = savgol_smooth(np.asarray(hip_mid[:, 0], dtype=np.float64)) * lead_sign
    shoulder_x = savgol_smooth(np.asarray(sho_mid[:, 0], dtype=np.float64)) * lead_sign

    lead_ankle_x = float(frames[p.setup, LEFT_ANKLE if is_lead_left else RIGHT_ANKLE, 0]) * lead_sign
    trail_ankle_x = float(frames[p.setup, RIGHT_ANKLE if is_lead_left else LEFT_ANKLE, 0]) * lead_sign
    trail_heel_y = savgol_smooth(np.asarray(frames[:, RIGHT_HEEL if is_lead_left else LEFT_HEEL, 1], dtype=np.float64))
    lead_knee_x = savgol_smooth(np.asarray(frames[:, LEFT_KNEE if is_lead_left else RIGHT_KNEE, 0], dtype=np.float64)) * lead_sign

    mid_downswing = p.downswing
    down_lo, down_hi = p.top_of_backswing, p.impact + 1

    head_drift = np.abs(nose_x[p.setup: p.top_of_backswing + 1] - nose_x[p.setup]) / IN
    streak = 0
    head_sway_triggered = False
    for v in head_drift:
        streak = streak + 1 if v > 4.5 else 0
        if streak > 3:
            head_sway_triggered = True
            break
    peak_drift_in = float(np.max(head_drift)) if len(head_drift) else 0.0
    if head_sway_triggered:
        append_fault("head_sway", "Head Sway", "major", "top_of_backswing", peak_drift_in, 4.5, "in",
            f"Your head drifted {peak_drift_in:.1f} in laterally between address and the top "
            "(tolerance ≤ 4.5 in, sustained). A stable head is the axis of the coil.")

    rise_in = float(np.max(nose_y[down_lo:down_hi]) - nose_y[p.setup]) / IN
    if rise_in > 2.0:
        append_fault("head_lift", "Early Head Lift", "minor", "downswing", rise_in, 2.0, "in",
            f"Your head rose {rise_in:.1f} in before impact (tolerance ≤ 2.0 in) — "
            "standing up early costs compression and low-point control.")

    drop_in = float(nose_y[p.setup] - np.min(nose_y[down_lo:down_hi])) / IN
    if drop_in > 3.0:
        append_fault("head_dip", "Head Dipping", "minor", "downswing", drop_in, 3.0, "in",
            f"Your head dropped {drop_in:.1f} in during the downswing (tolerance ≤ 3.0 in) — "
            "excessive squat/dip makes strike depth unpredictable.")

    spine_delta_at_impact = float(metrics.spine_delta_deg[p.impact])
    if spine_delta_at_impact > 8.0:
        append_fault("spine_retention", "Loss of Spine Angle", "minor", "downswing", spine_delta_at_impact, 8.0, "deg",
            f"Your spine angle changed {spine_delta_at_impact:.1f}° between address and impact "
            "(tolerance ≤ 8°).")

    torso_lean_in = ((shoulder_x[p.top_of_backswing] - pelvis_x[p.top_of_backswing])
               - (shoulder_x[p.setup] - pelvis_x[p.setup])) / IN
    if torso_lean_in > 1.5:
        append_fault("reverse_spine", "Reverse Spine Angle", "major", "top_of_backswing",
            torso_lean_in, 1.5, "in",
            f"Your upper body tilted {torso_lean_in:.1f} in TOWARD the target at the top "
            "(tolerance ≤ 1.5 in) — the classic reverse-pivot back-strain pattern.")

    shoulder_turn_deg = float(np.max(np.abs(metrics.shoulder_rotation_deg)))
    if shoulder_turn_deg > 125.0:
        append_fault("overswing", "Overswing", "major", "top_of_backswing", shoulder_turn_deg, 125.0, "deg",
            f"Your shoulders turned {shoulder_turn_deg:.0f}° (tolerance ≤ 125°, camera-perspective safe) — past parallel "
            "the structure breaks down before the downswing even starts.")

    sho_rot = np.asarray(metrics.shoulder_rotation_deg)
    hip_rot = np.asarray(metrics.hip_rotation_deg)
    sho_range = abs(float(sho_rot[p.impact] - sho_rot[p.top_of_backswing])) or 1e-9
    hip_range = abs(float(hip_rot[p.impact] - hip_rot[p.top_of_backswing])) or 1e-9
    snatch_triggered = False
    for t in range(p.top_of_backswing + 1, p.impact):
        sho_frac = abs(float(sho_rot[t] - sho_rot[p.top_of_backswing])) / sho_range
        hip_frac = abs(float(hip_rot[t] - hip_rot[p.top_of_backswing])) / hip_range
        if sho_frac >= 0.10:
            snatch_triggered = hip_frac < 0.02
            break
    if snatch_triggered:
        append_fault("shoulder_snatch", "Lead Shoulder Snatch", "major", "downswing", 10.0, 2.0, "%",
            "Your shoulders started uncoiling before your hips moved — transition must "
            "sequence from the ground up (hips lead, shoulders follow).")

    wrist_cock = _signed_wrist_cock(frames, is_lead_left)
    cock_at_top = float(np.mean(wrist_cock[max(0, p.top_of_backswing - 2): p.top_of_backswing + 3]))
    if cock_at_top >= 0:
        cock_polarity = 1.0
    else:
        cock_polarity = -1.0
    wrist_cock = wrist_cock * cock_polarity
    wrist_angle = 180.0 - np.abs(wrist_cock)

    if is_lead_left:
        hands_idx = (LEFT_PINKY, LEFT_INDEX, LEFT_THUMB)
        wr_idx = LEFT_WRIST
    else:
        hands_idx = (RIGHT_PINKY, RIGHT_INDEX, RIGHT_THUMB)
        wr_idx = RIGHT_WRIST
    hand_sep = float(np.mean(np.linalg.norm(
        frames[:, hands_idx, :3].mean(axis=1) - frames[:, wr_idx, :3], axis=1)))
    hands_resolved = hand_sep > 1.2 * IN

    top_angle = float(np.mean(wrist_angle[max(0, p.top_of_backswing - 1): p.top_of_backswing + 2]))
    early_downswing_wrist_window = wrist_angle[down_lo + 2: max(down_lo + 3, mid_downswing + 1)]
    cast_max = float(np.max(early_downswing_wrist_window)) if len(early_downswing_wrist_window) else 0.0
    if hands_resolved and top_angle < 150.0 and cast_max > 165.0:
        append_fault("casting", "Casting / Early Release", "critical", "downswing", cast_max, 165.0, "deg",
            f"Your wrist angle opened to {cast_max:.0f}° before mid-downswing "
            "(hold ≤ 165° until the shaft reaches horizontal) — the lag you built "
            f"at the top ({top_angle:.0f}°) was thrown away in the first half of the downswing.")

    if is_lead_left:
        el = (LEFT_SHOULDER, LEFT_ELBOW, LEFT_WRIST)
    else:
        el = (RIGHT_SHOULDER, RIGHT_ELBOW, RIGHT_WRIST)
    elbow_angle = savgol_smooth(np.asarray([
        joint_angle_3d(frames[t, el[0], :3], frames[t, el[1], :3], frames[t, el[2], :3])
        for t in range(T)
    ], dtype=np.float64))
    post_impact_elbow_window = elbow_angle[max(0, p.impact - 1): p.follow_through + 1]
    flex_series = 180.0 - post_impact_elbow_window
    streak = 0
    wing_fired = False
    wing_peak = 0.0
    for v in flex_series:
        wing_peak = max(wing_peak, float(v))
        streak = streak + 1 if v > 52.0 else 0
        if streak >= 3:
            wing_fired = True
    if wing_fired:
        append_fault("chicken_wing", "Chicken Wing", "major", "impact", wing_peak, 52.0, "deg",
            f"Your lead elbow flexed {wing_peak:.0f}° through impact and held it for "
            "3+ frames (tolerance ≤ 52° sustained) — the elbow must extend down the "
            "target line, not break outward.")

    flip_deg = float(np.min(wrist_cock[max(0, p.impact - 1): p.impact + 2]))
    if hands_resolved and top_angle < 150.0 and flip_deg < -10.0:
        append_fault("flip_scoop", "Flip / Scoop at Impact", "critical", "impact",
            abs(flip_deg), 10.0, "deg",
            f"Your wrists flipped {abs(flip_deg):.0f}° past neutral at contact — dynamic "
            "loft is added instead of compressed; shaft must lean forward at strike.")

    hip_slide_in = (float(np.max(pelvis_x[down_lo:down_hi])) - lead_ankle_x) / IN
    if hip_slide_in > 1.0:
        append_fault("hip_slide", "Hip Slide", "major", "downswing", hip_slide_in, 1.0, "in",
            f"Your pelvis slid {hip_slide_in:.1f} in past your lead ankle (tolerance ≤ 1.0 in) — "
            "rotate around the lead hip socket instead of sliding through it.")

    thrust = np.asarray(metrics.hip_thrust)
    thrust_in = float(np.max(np.abs(thrust[down_lo:down_hi] - thrust[p.setup]))) * PLAYER_HEIGHT_IN
    spine_gain = float(metrics.spine_angle_deg[p.impact] - metrics.spine_angle_deg[p.top_of_backswing])
    if thrust_in > 2.5 or spine_gain > 8.0:
        append_fault("early_extension", "Early Extension", "critical", "downswing",
            max(thrust_in, 0.0), 2.5, "in",
            f"Your hips moved {thrust_in:.1f} in toward the ball during the downswing "
            "(tolerance ≤ 2.5 in). This forces a stand-up delivery and blocks rotation.")

    hips_vel = np.asarray(metrics.kinematic_velocity["hips"])
    stall_lo = down_lo + int(0.6 * (p.impact - down_lo))
    down_peak = float(np.max(hips_vel[down_lo:down_hi])) or 1e-9
    late_downswing_hip_vel = hips_vel[stall_lo: p.impact + 1]
    streak = 0
    hip_stalled = False
    for v in late_downswing_hip_vel:
        streak = streak + 1 if v < 0.15 * down_peak else 0
        if streak >= 3:
            hip_stalled = True
            break
    if hip_stalled:
        append_fault("hip_stall", "Hip Stall", "minor", "downswing", 15.0, 15.0, "%",
            "Your pelvis rotation stalled before impact — when the engine stops, the "
            "hands must flip to square the face. Keep the hips turning through strike.")

    heel_rise_in = (float(np.max(trail_heel_y[down_lo: mid_downswing + 1])) - float(trail_heel_y[p.setup])) / IN
    if heel_rise_in > 2.5:
        append_fault("trail_heel_lift", "Premature Trail Heel Lift", "minor", "downswing",
            heel_rise_in, 2.5, "in",
            f"Your trail heel rose {heel_rise_in:.1f} in early in the downswing "
            "(tolerance ≤ 2.5 in) — stay grounded to keep pressure driving forward.")

    backswing_knee_track = lead_knee_x[p.setup: p.top_of_backswing + 1]
    knee_collapse_in = (float(lead_knee_x[p.setup]) - float(np.min(backswing_knee_track))) / IN
    if knee_collapse_in > 2.0:
        append_fault("lead_knee_collapse", "Lead Knee Collapse", "major", "top_of_backswing",
            knee_collapse_in, 2.0, "in",
            f"Your lead knee dove {knee_collapse_in:.1f} in toward the trail leg in the backswing "
            "(tolerance ≤ 2.0 in) — keep its flex stable to preserve the lower-body coil.")

    hip_sway = np.asarray(metrics.hip_sway)
    sway_bw_in = -float(np.min(hip_sway[p.setup: p.top_of_backswing + 1])) * PLAYER_HEIGHT_IN
    if sway_bw_in > 2.5:
        append_fault("sway", "Hip Sway (Backswing)", "major", "top_of_backswing", sway_bw_in, 2.5, "in",
            f"Your hips slid {sway_bw_in:.1f} in away from the target going back "
            "(tolerance ≤ 2.5 in) — coil into the trail hip, don't drift off the ball.")

    seq = kinematic_sequence_report(metrics, p.top_of_backswing, p.impact)
    if not seq["sequence_correct"]:
        peaks = seq["peak_frames"]
        order_str = " → ".join(sorted(peaks, key=lambda k: peaks[k]))
        append_fault("kinematic_sequence", "Kinematic Sequence Out of Order", "major", "downswing",
            0.0, 0.0, "order",
            f"Your peak-speed order was {order_str}; the efficient chain is "
            "hips → torso → arms → hands.")

    faults.sort(key=lambda f: SEVERITY_ORDER.get(f.severity, 9))
    return faults


def group_of(code: str) -> str:
    buckets: List[Tuple[str, Tuple[str, ...]]] = [
        ("Head & Spine", ("head_sway", "head_lift", "head_dip", "spine_retention")),
        ("Shoulders & Torso", ("reverse_spine", "overswing", "shoulder_snatch")),
        ("Arms & Wrists", ("casting", "chicken_wing", "flip_scoop")),
        ("Hips & Pelvis", ("hip_slide", "early_extension", "hip_stall", "sway")),
        ("Legs & Weight", ("trail_heel_lift", "lead_knee_collapse")),
        ("Sequencing", ("kinematic_sequence",)),
    ]
    for label, members in buckets:
        if code in members:
            return label
    return "Other"
