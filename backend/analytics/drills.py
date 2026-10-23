"""
SwingAI — Intelligent compliance & drill-recommendation engine.

A deterministic rules layer on top of the ML telemetry. Each rule inspects the
phase-windowed deviation series, decides whether a fault fired, quantifies it
in coach-friendly units, and emits a markdown drill card with explicit target
parameters ("Target: keep hip sway under 2.5 in. Yours: 4.8 in").
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Sequence

import numpy as np

from .dtw_aligner import SwingPhases
from .metrics import DeviationFrame, SwingMetrics, kinematic_sequence_report

# Conversion: normalized height units -> inches, assuming a 70 in golfer.
# (Good enough for coaching copy; the raw normalized value is also reported.)
PLAYER_HEIGHT_IN = 70.0

SEVERITY_ORDER = {"critical": 0, "major": 1, "minor": 2}


@dataclass
class Fault:
    code: str
    name: str
    severity: str            # "critical" | "major" | "minor"
    phase: str               # which swing phase the fault lives in
    measured: float
    target: float
    unit: str
    summary: str


@dataclass
class DrillCard:
    fault: Fault
    drill_name: str
    markdown: str


def _window(series: np.ndarray, start: int, end: int) -> np.ndarray:
    start = int(np.clip(start, 0, len(series) - 1))
    end = int(np.clip(end, start + 1, len(series)))
    return series[start:end]


def detect_faults(
    user: SwingMetrics,
    pro: SwingMetrics,
    user_phases: SwingPhases,
    deviations: Sequence[DeviationFrame],
) -> List[Fault]:
    faults: List[Fault] = []
    p = user_phases

    # ------------------------------------------------------------------
    # 1) EARLY EXTENSION — pelvis thrusts toward the ball in the downswing,
    #    spine angle stands up. Trigger: hip thrust > 4.5% of height OR
    #    spine-angle gain > 8 deg between top and impact.
    # ------------------------------------------------------------------
    # Depth sign depends on camera convention (MediaPipe: more-negative z is
    # closer to the lens), so measure the peak |displacement| from setup.
    thrust_win = _window(user.hip_thrust, p.top_of_backswing, p.impact + 1)
    thrust_in = float(np.max(np.abs(thrust_win - user.hip_thrust[p.setup]))) * PLAYER_HEIGHT_IN
    spine_at_top = float(user.spine_angle_deg[p.top_of_backswing])
    spine_at_impact = float(user.spine_angle_deg[p.impact])
    spine_gain = spine_at_impact - spine_at_top  # trunk standing up => angle -> 90
    if thrust_in > 3.2 or spine_gain > 8.0:
        faults.append(
            Fault(
                code="early_extension",
                name="Early Extension",
                severity="critical",
                phase="downswing",
                measured=round(max(thrust_in, 0.0), 1),
                target=2.0,
                unit="in",
                summary=(
                    f"Your hips moved {max(thrust_in, 0.0):.1f} in toward the ball during the "
                    f"downswing and your spine angle rose {max(spine_gain, 0.0):.1f}°. "
                    "This forces a stand-up delivery and blocks rotation."
                ),
            )
        )

    # ------------------------------------------------------------------
    # 2) CHICKEN WING — lead elbow bends prematurely at/after impact.
    #    Trigger: lead-arm interior angle < 155 deg in the impact window
    #    while the pro holds > 165 deg.
    # ------------------------------------------------------------------
    impact_win_u = _window(user.lead_arm_angle_deg, p.impact - 2, p.follow_through + 1)
    impact_min = float(np.min(impact_win_u))
    if impact_min < 155.0:
        faults.append(
            Fault(
                code="chicken_wing",
                name="Chicken Wing (Lead-Elbow Breakdown)",
                severity="major",
                phase="impact",
                measured=round(impact_min, 1),
                target=165.0,
                unit="deg",
                summary=(
                    f"Your lead elbow collapsed to {impact_min:.0f}° through impact "
                    "(target ≥ 165°). The bend robs width, loft control, and speed."
                ),
            )
        )

    # ------------------------------------------------------------------
    # 3) SWAY — excessive lateral hip slide away from the target in the
    #    backswing instead of rotating into the trail hip.
    # ------------------------------------------------------------------
    sway_win = _window(user.hip_sway, p.setup, p.top_of_backswing + 1)
    # Away from target = negative x by our convention.
    sway_in = float(-np.min(sway_win)) * PLAYER_HEIGHT_IN
    if sway_in > 2.5:
        faults.append(
            Fault(
                code="sway",
                name="Hip Sway",
                severity="major",
                phase="top_of_backswing",
                measured=round(sway_in, 1),
                target=2.5,
                unit="in",
                summary=(
                    f"Your hips slid {sway_in:.1f} in away from the target in the backswing "
                    "(target ≤ 2.5 in). Sway kills the coil and makes low-point control random."
                ),
            )
        )

    # ------------------------------------------------------------------
    # 4) SPINE-ANGLE RETENTION vs PRO — sustained delta over the DTW path.
    # ------------------------------------------------------------------
    if deviations:
        spine_deltas = np.array([d.spine_angle_delta for d in deviations])
        worst = float(np.max(np.abs(spine_deltas)))
        if worst > 8.0:
            faults.append(
                Fault(
                    code="spine_retention",
                    name="Spine-Angle Retention",
                    severity="minor",
                    phase="downswing",
                    measured=round(worst, 1),
                    target=8.0,
                    unit="deg",
                    summary=(
                        f"Your spine angle deviated up to {worst:.1f}° from the model swing "
                        "(tolerance ± 8°)."
                    ),
                )
            )

    # ------------------------------------------------------------------
    # 5) KINEMATIC SEQUENCE — hips -> torso -> arms -> hands ordering.
    # ------------------------------------------------------------------
    seq = kinematic_sequence_report(user)
    if not seq["sequence_correct"]:
        peaks: Dict[str, int] = seq["peak_frames"]  # type: ignore[assignment]
        order_str = " → ".join(sorted(peaks, key=lambda k: peaks[k]))
        faults.append(
            Fault(
                code="kinematic_sequence",
                name="Kinematic Sequence Out of Order",
                severity="major",
                phase="downswing",
                measured=0.0,
                target=0.0,
                unit="order",
                summary=(
                    f"Your peak-speed order was {order_str}; the efficient chain is "
                    "hips → torso → arms → hands. Energy is leaking up the chain early."
                ),
            )
        )

    faults.sort(key=lambda f: SEVERITY_ORDER.get(f.severity, 9))
    return faults


# ---------------------------------------------------------------------------
# Drill library
# ---------------------------------------------------------------------------
def _card(fault: Fault, drill_name: str, body: str) -> DrillCard:
    header = (
        f"### {drill_name}\n\n"
        f"**Fault:** {fault.name} · **Severity:** {fault.severity.title()} · "
        f"**Phase:** {fault.phase.replace('_', ' ').title()}\n\n"
        f"> **Target:** {fault.target:g} {fault.unit} · **Yours:** {fault.measured:g} {fault.unit}\n\n"
        f"{fault.summary}\n\n"
    )
    return DrillCard(fault=fault, drill_name=drill_name, markdown=header + body)


DRILL_BUILDERS = {
    "early_extension": lambda f: _card(
        f,
        "Chair Drill (Butt-Back Wall Drill)",
        "**Setup**\n\n"
        "1. Address a ball with a chair back (or wall) lightly touching your glutes.\n"
        "2. Make slow-motion swings keeping **both glutes in contact** until lead-arm-parallel in the downswing.\n"
        "3. At impact, your **trail glute** should still brush the chair.\n\n"
        "**Reps:** 3 sets × 10 slow swings, then 5 at 75% speed.\n\n"
        "**Checkpoint:** hip thrust toward the ball under **2.0 in** on your next upload.",
    ),
    "chicken_wing": lambda f: _card(
        f,
        "Glove Under Armpit Drill",
        "**Setup**\n\n"
        "1. Tuck a glove (or headcover) under your **lead armpit**.\n"
        "2. Hit half-shots keeping the glove pinned from setup through waist-high finish.\n"
        "3. The glove may only drop **after** both arms extend past impact.\n\n"
        "**Reps:** 20 balls at 50% speed, 10 at 75%.\n\n"
        "**Checkpoint:** lead-elbow angle ≥ **165°** through the impact window.",
    ),
    "sway": lambda f: _card(
        f,
        "Crossed-Arms Stance Pivot Drill",
        "**Setup**\n\n"
        "1. Cross your arms over your chest, club across your shoulders.\n"
        "2. Rotate to a full backswing turn while keeping your **trail hip inside your trail ankle**.\n"
        "3. Feel pressure screw **into** the trail heel, not slide over it.\n\n"
        "**Reps:** 3 sets × 12 pivots; add a mirror or alignment stick outside the trail hip.\n\n"
        "**Checkpoint:** lateral hip sway under **2.5 in** at the top.",
    ),
    "spine_retention": lambda f: _card(
        f,
        "Head-on-Wall Posture Drill",
        "**Setup**\n\n"
        "1. Set up with your forehead lightly touching a wall-mounted pad (or door frame).\n"
        "2. Rehearse backswing and downswing keeping constant light head pressure.\n"
        "3. Losing contact = losing spine angle.\n\n"
        "**Reps:** 3 sets × 8 rehearsals, eyes on a fixed ball position.\n\n"
        "**Checkpoint:** spine-angle deviation within **± 8°** of the model swing.",
    ),
    "kinematic_sequence": lambda f: _card(
        f,
        "Step-Change-of-Direction Drill",
        "**Setup**\n\n"
        "1. Start with feet together; swing to the top.\n"
        "2. **Step** the lead foot toward the target to start the downswing — the step forces "
        "the lower body to fire first.\n"
        "3. Let the torso, arms, and club lag behind the step in order.\n\n"
        "**Reps:** 15 swings with a mid-iron at 60–70% speed.\n\n"
        "**Checkpoint:** peak-speed order hips → torso → arms → hands.",
    ),
}


def recommend_drills(faults: Sequence[Fault]) -> List[DrillCard]:
    return [DRILL_BUILDERS[f.code](f) for f in faults if f.code in DRILL_BUILDERS]
