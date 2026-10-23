/**
 * SwingAI V4 — automated drill recommendation library (/src/engine/drills.ts).
 *
 * Every detectable fault maps to a structured drill object:
 *   title           clean drill name
 *   description     step-by-step execution instructions
 *   focusKey        the ONE motion/feel to focus on
 *   recommendedReps prescription (e.g. "10 slow-motion reps")
 *
 * Coaching content is grounded in published swing research:
 *  · Force-plate studies: tour players carry 75–90% of pressure on the LEAD
 *    foot at impact and 98–100% into the finish; amateurs leave pressure on
 *    the trail foot ("hanging back"). Pressure starts shifting forward in the
 *    FIRST move of transition (~80% → ~52% trail-side almost immediately).
 *  · Wrist-sensor data (HackMotion): pros reduce lead-wrist extension by
 *    20–25° between the top and impact — a flat-to-flexed lead wrist is what
 *    compresses the ball; an extended (cupped) lead wrist at impact = flip,
 *    added loft, and an open face.
 *  · TPI-style definitions for early extension (hips toward the ball),
 *    reverse spine angle (upper body toward target at the top), and casting
 *    (lag released in the first half of the downswing).
 */

export interface DrillSpec {
  readonly title: string;
  readonly description: readonly string[]; // ordered steps
  readonly focusKey: string;
  readonly recommendedReps: string;
}

export const DRILL_LIBRARY: Record<string, DrillSpec> = {
  // ---------------- HEAD & SPINE ----------------------------------------
  head_sway: {
    title: "Head Against Wall Drill",
    description: [
      "Set up with the trail side of your head lightly touching a wall, doorframe, or your shadow line.",
      "Make slow backswing pivots keeping that light contact the whole way to the top.",
      "If contact is lost, you slid instead of coiled — rewind and turn around a still head.",
    ],
    focusKey: "Rotate around a stable head — the head is the axis, not a passenger.",
    recommendedReps: "3 × 10 slow-motion pivots",
  },
  head_lift: {
    title: "Eyes-Down Coin Drill",
    description: [
      "Place a coin just behind the ball position.",
      "Hit half-speed shots keeping both eyes on the coin until the ball is gone.",
      "Feel the chest stay flexed over the ball through the strike — stand up only in the finish.",
    ],
    focusKey: "Stay in posture through impact; the head rises only after the ball leaves.",
    recommendedReps: "15 balls at 60% speed",
  },
  head_dip: {
    title: "Cap-Line Mirror Drill",
    description: [
      "Face a mirror with a tape line at the height of your cap brim at address.",
      "Rehearse downswings — squatting pressure is fine, but the cap must not drop below the line by more than a ball's width.",
      "Build the feel of level rotation instead of a vertical dive.",
    ],
    focusKey: "Compress with rotation, not by collapsing height.",
    recommendedReps: "3 × 8 mirror rehearsals",
  },
  spine_retention: {
    title: "Head-on-Wall Posture Drill",
    description: [
      "Set up with your forehead resting lightly on a padded wall or door frame.",
      "Rehearse the backswing and downswing keeping constant light pressure — losing contact means losing your spine angle.",
      "Progress to slow swings away from the wall recreating the same feel.",
    ],
    focusKey: "The forward bend you build at address is kept until after impact.",
    recommendedReps: "3 × 8 rehearsals, then 10 half-shots",
  },
  reverse_spine: {
    title: "Trail-Side Stack Drill",
    description: [
      "Cross a club over your chest and turn to the top in front of a mirror.",
      "Check that your sternum stays stacked over the inside of the trail thigh — never leaning toward the target.",
      "Feel the trail side LOAD as you coil; the lead shoulder works down, not the spine toward the target.",
    ],
    focusKey: "Load into the trail hip at the top — upper body tilts away from, never toward, the target.",
    recommendedReps: "3 × 10 mirror turns",
  },

  // ---------------- SHOULDERS, ARMS & WRISTS ----------------------------
  flat_shoulder_turn: {
    title: "Lead-Shoulder-Down Turn Drill",
    description: [
      "Hold a club across your chest and bow into your address posture.",
      "Turn back so the lead shoulder works DOWN toward the ball — the club across your chest should point at or just outside the ball at the top.",
      "A turn that stays level with the ground is what tips the downswing over the top.",
    ],
    focusKey: "Shoulders turn on the incline your spine sets — lead shoulder down and under.",
    recommendedReps: "3 × 12 posture turns",
  },
  casting: {
    title: "Pump Drill",
    description: [
      "Swing to the top, then pump down slowly to shaft-horizontal and PAUSE — the wrist angle must still be ~90°.",
      "Return to the top and repeat the pump twice, keeping the clubhead lagging behind the hands.",
      "On the third pump, let it go — the stored angle releases at the bottom, not the top, of the downswing.",
    ],
    focusKey: "Retain the 90° wrist set until the hands reach the trail thigh — lag IS the speed multiplier.",
    recommendedReps: "3 sets of pump-pump-swing, 10 balls at 70%",
  },
  chicken_wing: {
    title: "Head Cover Under Armpit Drill",
    description: [
      "Pin a head cover or towel under your LEAD armpit at address.",
      "Hit half-shots keeping it pinned from setup through a waist-high finish — the lead elbow must extend down the target line after impact.",
      "The cover may only fall once both arms are fully released past the ball.",
    ],
    focusKey: "Lead arm stays connected and EXTENDS through impact instead of breaking outward.",
    recommendedReps: "20 balls at 50%, then 10 at 75%",
  },
  lead_arm_breakdown: {
    title: "Headcover-Between-Forearms Width Drill",
    description: [
      "Hold a headcover between your forearms and make backswing turns.",
      "If the lead elbow bends, the cover drops — keep the triangle intact to the top.",
      "Width in the backswing is stored radius; a bent lead arm shrinks the whole arc.",
    ],
    focusKey: "Keep the lead arm long — width at the top equals speed at the bottom.",
    recommendedReps: "3 × 10 turns",
  },
  flip_scoop: {
    title: "Impact-Bag Compression Drill",
    description: [
      "Strike an impact bag and FREEZE at contact: hands ahead of the clubhead, shaft leaning toward the target.",
      "Check the lead wrist — it must be flat or slightly bowed, never cupped. Wrist-sensor data shows pros lose 20–25° of lead-wrist extension from the top to impact; that flexion is what compresses the ball.",
      "Hold each strike for two full seconds before resetting.",
    ],
    focusKey: "Flat-to-bowed lead wrist + forward shaft lean = compression. A cupped wrist at impact adds loft and opens the face.",
    recommendedReps: "3 × 10 frozen strikes",
  },

  // ---------------- SHOULDERS/TRANSITION --------------------------------
  overswing: {
    title: "Three-Quarter Top Drill",
    description: [
      "Swing to what feels like three-quarters and have a partner (or camera) confirm the club never passes parallel.",
      "Pump twice from that compact top, then hit.",
      "Past parallel the lead arm bends and the club drops — length you can't control is length you don't own.",
    ],
    focusKey: "A shorter, structured top out-drives a long collapsed one.",
    recommendedReps: "15 balls with camera checks",
  },
  shoulder_snatch: {
    title: "Lower-Body-First Transition Drill",
    description: [
      "From the top, start the downswing by bumping and turning the hips while the shoulders STAY closed.",
      "Pump that first move twice — hips fire, chest still facing away from the target.",
      "The third rehearsal hits the ball. Transition sequences from the ground up.",
    ],
    focusKey: "Hips uncoil first; shoulders are dragged, never the drivers.",
    recommendedReps: "3 × 8 pump sequences",
  },

  // ---------------- HIPS, LEGS & FOOTWORK -------------------------------
  early_extension: {
    title: "Chair Behind Glutes Drill",
    description: [
      "Address a ball with a chair back (or bag) lightly touching your glutes.",
      "Swing down keeping the TRAIL hip in contact with the chair as you uncoil — the hips rotate along the chair, never thrust toward the ball.",
      "At impact your trail glute should still brush the chair; if your hips leave it, you extended early.",
    ],
    focusKey: "Hips rotate BACK and around, never forward toward the ball line.",
    recommendedReps: "3 × 10 slow swings, then 5 at 75%",
  },
  hip_slide: {
    title: "Alignment-Stick Lead-Post Drill",
    description: [
      "Plant an alignment stick vertically just outside your lead hip.",
      "Swing down shifting pressure forward WITHOUT bumping the stick — the pelvis posts up and rotates around the lead leg.",
      "Sliding past the stick means the low point drifts and the face never squares.",
    ],
    focusKey: "Pressure forward, then ROTATE around a firm lead post — slide becomes turn.",
    recommendedReps: "3 × 10 swings",
  },
  hip_stall: {
    title: "Belt-Buckle-Through Drill",
    description: [
      "Hit punch shots finishing with your belt buckle facing the target just after impact.",
      "Feel the pelvis keep accelerating through the strike — when the hips brake early, the hands must flip to square the face.",
      "Pros keep rotating: pressure reaches 98–100% lead side into the finish.",
    ],
    focusKey: "The engine never stalls — hips keep turning through the ball, not to it.",
    recommendedReps: "15 punch shots",
  },
  sway: {
    title: "Crossed-Arms Stance Pivot Drill",
    description: [
      "Cross your arms over your chest with a club held across your shoulders.",
      "Rotate to a full backswing turn keeping the trail hip INSIDE the trail ankle.",
      "Feel pressure screw down into the trail heel — coiling into the leg, not drifting over it.",
    ],
    focusKey: "The backswing is a coil into the trail hip, not a slide away from the target.",
    recommendedReps: "3 × 12 pivots",
  },
  lead_knee_collapse: {
    title: "Stable-Knee Ball Drill",
    description: [
      "Make backswing turns with a soccer ball (or that feel) held between your knees.",
      "The lead knee flexes TOWARD the ball position — it must not dive inward at the trail leg.",
      "A stable lead knee keeps the pelvis coiling instead of tilting.",
    ],
    focusKey: "Lead knee stays over the lead foot — flex, don't buckle.",
    recommendedReps: "3 × 10 turns",
  },
  trail_heel_lift: {
    title: "Grounded-Heel Pressure Drill",
    description: [
      "Hit 60%-speed shots keeping the trail heel planted until your hands pass the trail thigh in the downswing.",
      "Feel pressure flow from trail heel to lead heel along the ground — spinning onto the trail toe early dumps the ground force.",
      "The heel releases naturally AFTER impact as the body rotates through.",
    ],
    focusKey: "Use the ground: the trail heel stays down while pressure drives forward.",
    recommendedReps: "15 balls at 60%",
  },
  hanging_back: {
    title: "Step-Through Finish Drill",
    description: [
      "Hit a ball, and immediately after impact let the trail foot STEP forward past the lead foot, walking toward the target.",
      "It is impossible to step through while hanging back — pressure must reach the lead side first.",
      "Force-plate data: tour players have 75–90% of pressure on the lead foot AT impact and 98–100% in the finish. Match that feel.",
    ],
    focusKey: "Weight arrives on the lead side BEFORE the ball is struck — finish walking toward the target.",
    recommendedReps: "15 step-through swings",
  },

  // ---------------- SEQUENCING ------------------------------------------
  kinematic_sequence: {
    title: "Step-Change-of-Direction Drill",
    description: [
      "Start with your feet together and swing to the top.",
      "STEP the lead foot toward the target to begin the downswing — the step forces the lower body to fire first.",
      "Let the torso, arms, and club lag behind the step in order: hips → torso → arms → hands.",
    ],
    focusKey: "Energy flows up the chain from the ground — each link peaks after the one below it.",
    recommendedReps: "15 swings with a mid-iron at 60–70%",
  },
};

/** Fallback for any future fault code without a dedicated drill. */
export const GENERIC_DRILL: DrillSpec = {
  title: "Slow-Motion Rehearsal",
  description: [
    "Rehearse the flagged position at 25% speed in front of a mirror or camera.",
    "Exaggerate the correction, then blend it back into half-speed swings.",
  ],
  focusKey: "Feel the corrected position before adding speed.",
  recommendedReps: "10 slow-motion reps",
};
