"""
SwingAI V4 — automated drill recommendation mapping (Python mirror of
frontend/src/engine/drills.ts).

Every detectable fault maps to a structured drill object: title, step-by-step
description, focusKey (the one motion/feel to own), and recommendedReps.
Coaching content is grounded in published research: force-plate studies (tour
players carry 75-90% of pressure on the lead foot at impact, 98-100% into the
finish) and wrist-sensor data (pros reduce lead-wrist extension 20-25° from
the top to impact — flat-to-flexed lead wrist = compression; cupped = flip).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Sequence, Tuple

# Conversion: normalized height units -> inches, assuming a 70 in golfer.
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
    title: str = ""
    description: str = ""
    focus_key: str = ""
    recommended_reps: str = ""


# code -> (title, steps, focus_key, recommended_reps)
DrillSpec = Tuple[str, Tuple[str, ...], str, str]

DRILL_LIBRARY: Dict[str, DrillSpec] = {
    "head_sway": (
        "Head Against Wall Drill",
        ("Set up with the trail side of your head lightly touching a wall, doorframe, or your shadow line.",
         "Make slow backswing pivots keeping that light contact the whole way to the top.",
         "If contact is lost, you slid instead of coiled — rewind and turn around a still head."),
        "Rotate around a stable head — the head is the axis, not a passenger.",
        "3 × 10 slow-motion pivots",
    ),
    "head_lift": (
        "Eyes-Down Coin Drill",
        ("Place a coin just behind the ball position.",
         "Hit half-speed shots keeping both eyes on the coin until the ball is gone.",
         "Feel the chest stay flexed over the ball through the strike — stand up only in the finish."),
        "Stay in posture through impact; the head rises only after the ball leaves.",
        "15 balls at 60% speed",
    ),
    "head_dip": (
        "Cap-Line Mirror Drill",
        ("Face a mirror with a tape line at the height of your cap brim at address.",
         "Rehearse downswings — squat pressure is fine, but the cap must not drop below the line by more than a ball's width.",
         "Build the feel of level rotation instead of a vertical dive."),
        "Compress with rotation, not by collapsing height.",
        "3 × 8 mirror rehearsals",
    ),
    "spine_retention": (
        "Head-on-Wall Posture Drill",
        ("Set up with your forehead resting lightly on a padded wall or door frame.",
         "Rehearse the backswing and downswing keeping constant light pressure — losing contact means losing your spine angle.",
         "Progress to slow swings away from the wall recreating the same feel."),
        "The forward bend you build at address is kept until after impact.",
        "3 × 8 rehearsals, then 10 half-shots",
    ),
    "reverse_spine": (
        "Trail-Side Stack Drill",
        ("Cross a club over your chest and turn to the top in front of a mirror.",
         "Check that your sternum stays stacked over the inside of the trail thigh — never leaning toward the target.",
         "Feel the trail side LOAD as you coil; the lead shoulder works down, not the spine toward the target."),
        "Load into the trail hip at the top — upper body tilts away from, never toward, the target.",
        "3 × 10 mirror turns",
    ),
    "casting": (
        "Pump Drill",
        ("Swing to the top, then pump down slowly to shaft-horizontal and PAUSE — the wrist angle must still be ~90°.",
         "Return to the top and repeat the pump twice, keeping the clubhead lagging behind the hands.",
         "On the third pump, let it go — the stored angle releases at the bottom, not the top, of the downswing."),
        "Retain the 90° wrist set until the hands reach the trail thigh — lag IS the speed multiplier.",
        "3 sets of pump-pump-swing, 10 balls at 70%",
    ),
    "chicken_wing": (
        "Head Cover Under Armpit Drill",
        ("Pin a head cover or towel under your LEAD armpit at address.",
         "Hit half-shots keeping it pinned from setup through a waist-high finish — the lead elbow must extend down the target line after impact.",
         "The cover may only fall once both arms are fully released past the ball."),
        "Lead arm stays connected and EXTENDS through impact instead of breaking outward.",
        "20 balls at 50%, then 10 at 75%",
    ),
    "flip_scoop": (
        "Impact-Bag Compression Drill",
        ("Strike an impact bag and FREEZE at contact: hands ahead of the clubhead, shaft leaning toward the target.",
         "Check the lead wrist — flat or slightly bowed, never cupped. Pros lose 20-25° of lead-wrist extension from top to impact; that flexion compresses the ball.",
         "Hold each strike for two full seconds before resetting."),
        "Flat-to-bowed lead wrist + forward shaft lean = compression. A cupped wrist at impact adds loft and opens the face.",
        "3 × 10 frozen strikes",
    ),
    "overswing": (
        "Three-Quarter Top Drill",
        ("Swing to what feels like three-quarters and have a partner (or camera) confirm the club never passes parallel.",
         "Pump twice from that compact top, then hit.",
         "Past parallel the lead arm bends and the club drops — length you can't control is length you don't own."),
        "A shorter, structured top out-drives a long collapsed one.",
        "15 balls with camera checks",
    ),
    "shoulder_snatch": (
        "Lower-Body-First Transition Drill",
        ("From the top, start the downswing by bumping and turning the hips while the shoulders STAY closed.",
         "Pump that first move twice — hips fire, chest still facing away from the target.",
         "The third rehearsal hits the ball. Transition sequences from the ground up."),
        "Hips uncoil first; shoulders are dragged, never the drivers.",
        "3 × 8 pump sequences",
    ),
    "early_extension": (
        "Chair Behind Glutes Drill",
        ("Address a ball with a chair back (or bag) lightly touching your glutes.",
         "Swing down keeping the TRAIL hip in contact with the chair as you uncoil — the hips rotate along the chair, never thrust toward the ball.",
         "At impact your trail glute should still brush the chair; if your hips leave it, you extended early."),
        "Hips rotate BACK and around, never forward toward the ball line.",
        "3 × 10 slow swings, then 5 at 75%",
    ),
    "hip_slide": (
        "Alignment-Stick Lead-Post Drill",
        ("Plant an alignment stick vertically just outside your lead hip.",
         "Swing down shifting pressure forward WITHOUT bumping the stick — the pelvis posts up and rotates around the lead leg.",
         "Sliding past the stick means the low point drifts and the face never squares."),
        "Pressure forward, then ROTATE around a firm lead post — slide becomes turn.",
        "3 × 10 swings",
    ),
    "hip_stall": (
        "Belt-Buckle-Through Drill",
        ("Hit punch shots finishing with your belt buckle facing the target just after impact.",
         "Feel the pelvis keep accelerating through the strike — when the hips brake early, the hands must flip to square the face.",
         "Pros keep rotating: pressure reaches 98-100% lead side into the finish."),
        "The engine never stalls — hips keep turning through the ball, not to it.",
        "15 punch shots",
    ),
    "sway": (
        "Crossed-Arms Stance Pivot Drill",
        ("Cross your arms over your chest with a club held across your shoulders.",
         "Rotate to a full backswing turn keeping the trail hip INSIDE the trail ankle.",
         "Feel pressure screw down into the trail heel — coiling into the leg, not drifting over it."),
        "The backswing is a coil into the trail hip, not a slide away from the target.",
        "3 × 12 pivots",
    ),
    "lead_knee_collapse": (
        "Stable-Knee Ball Drill",
        ("Make backswing turns with a soccer ball (or that feel) held between your knees.",
         "The lead knee flexes TOWARD the ball position — it must not dive inward at the trail leg.",
         "A stable lead knee keeps the pelvis coiling instead of tilting."),
        "Lead knee stays over the lead foot — flex, don't buckle.",
        "3 × 10 turns",
    ),
    "trail_heel_lift": (
        "Grounded-Heel Pressure Drill",
        ("Hit 60%-speed shots keeping the trail heel planted until your hands pass the trail thigh in the downswing.",
         "Feel pressure flow from trail heel to lead heel along the ground — spinning onto the trail toe early dumps the ground force.",
         "The heel releases naturally AFTER impact as the body rotates through."),
        "Use the ground: the trail heel stays down while pressure drives forward.",
        "15 balls at 60%",
    ),
    "kinematic_sequence": (
        "Step-Change-of-Direction Drill",
        ("Start with your feet together and swing to the top.",
         "STEP the lead foot toward the target to begin the downswing — the step forces the lower body to fire first.",
         "Let the torso, arms, and club lag behind the step in order: hips → torso → arms → hands."),
        "Energy flows up the chain from the ground — each link peaks after the one below it.",
        "15 swings with a mid-iron at 60-70%",
    ),
}

GENERIC_DRILL: DrillSpec = (
    "Slow-Motion Rehearsal",
    ("Rehearse the flagged position at 25% speed in front of a mirror or camera.",
     "Exaggerate the correction, then blend it back into half-speed swings."),
    "Feel the corrected position before adding speed.",
    "10 slow-motion reps",
)


def recommend_drills(faults: Sequence[Fault]) -> List[DrillCard]:
    cards: List[DrillCard] = []
    for f in faults:
        title, steps, focus, reps = DRILL_LIBRARY.get(f.code, GENERIC_DRILL)
        numbered = "\n".join(f"{i + 1}. {s}" for i, s in enumerate(steps))
        header = (
            f"### {title}\n\n"
            f"**Fault:** {f.name} · **Severity:** {f.severity.title()} · "
            f"**Phase:** {f.phase.replace('_', ' ')}\n\n"
            f"> **Target:** {f.target:g} {f.unit} · **Yours:** {f.measured:g} {f.unit}\n\n"
            f"{f.summary}\n\n"
        )
        body = f"{numbered}\n\n**Focus:** {focus}\n\n**Reps:** {reps}"
        cards.append(
            DrillCard(
                fault=f,
                drill_name=title,
                markdown=header + body,
                title=title,
                description=" ".join(steps),
                focus_key=focus,
                recommended_reps=reps,
            )
        )
    return cards


# `field` kept in the import surface for downstream dataclass extensions.
_ = field
