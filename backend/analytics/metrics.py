"""
SwingAI — Vector math & deviation-metric engine.

All pose data is expressed as a float64 array of shape (T, 33, 4):
    T   : number of frames
    33  : MediaPipe Pose Landmarker landmark count
    4   : (x, y, z, visibility)

Coordinate convention (MediaPipe world/normalized hybrid, after our normalization):
    +x : toward the target (down-the-line lateral axis after alignment)
    +y : DOWN in raw MediaPipe screen space (we flip to +y = up during normalization)
    +z : toward the camera (depth). "Toward the ball" for a face-on camera.

Core formula used throughout — the angle between two 3-D vectors:

    theta = arccos( (u . v) / (|u| |v|) )

and the joint angle at B formed by A-B-C uses u = A - B, v = C - B.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Sequence, Tuple

import numpy as np

# MediaPipe Pose landmark indices (33-point topology)
NOSE = 0
LEFT_EYE_INNER, LEFT_EYE, LEFT_EYE_OUTER = 1, 2, 3
RIGHT_EYE_INNER, RIGHT_EYE, RIGHT_EYE_OUTER = 4, 5, 6
LEFT_EAR, RIGHT_EAR = 7, 8
MOUTH_LEFT, MOUTH_RIGHT = 9, 10
LEFT_SHOULDER, RIGHT_SHOULDER = 11, 12
LEFT_ELBOW, RIGHT_ELBOW = 13, 14
LEFT_WRIST, RIGHT_WRIST = 15, 16
LEFT_PINKY, RIGHT_PINKY = 17, 18
LEFT_INDEX, RIGHT_INDEX = 19, 20
LEFT_THUMB, RIGHT_THUMB = 21, 22
LEFT_HIP, RIGHT_HIP = 23, 24
LEFT_KNEE, RIGHT_KNEE = 25, 26
LEFT_ANKLE, RIGHT_ANKLE = 27, 28
LEFT_HEEL, RIGHT_HEEL = 29, 30
LEFT_FOOT_INDEX, RIGHT_FOOT_INDEX = 31, 32

EPS = 1e-9


# Primitive vector operations
def angle_between(u: np.ndarray, v: np.ndarray) -> float:
    """
    Angle (degrees) between 3-D vectors u and v:

        theta = arccos( (u . v) / (|u| |v|) )

    Clamped to the valid arccos domain to be robust to floating-point drift.
    Returns 0.0 for degenerate (near-zero) vectors.
    """
    nu = float(np.linalg.norm(u))
    nv = float(np.linalg.norm(v))
    if nu < EPS or nv < EPS:
        return 0.0
    cos_theta = float(np.dot(u, v)) / (nu * nv)
    cos_theta = max(-1.0, min(1.0, cos_theta))
    return float(np.degrees(np.arccos(cos_theta)))


def joint_angle_3d(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """Interior angle at joint B (degrees) formed by segments B->A and B->C."""
    return angle_between(a - b, c - b)


def vector_series(frames: np.ndarray, idx_from: int, idx_to: int) -> np.ndarray:
    """(T, 3) series of the vector landmark[idx_from] -> landmark[idx_to]."""
    return frames[:, idx_to, :3] - frames[:, idx_from, :3]


def midpoint_series(frames: np.ndarray, idx_a: int, idx_b: int) -> np.ndarray:
    """(T, 3) series of the midpoint of two landmarks."""
    return 0.5 * (frames[:, idx_a, :3] + frames[:, idx_b, :3])


def savgol_smooth(x: np.ndarray, window: int = 5, order: int = 2) -> np.ndarray:
    """
    Savitzky-Golay smoothing along axis 0 — suppresses MediaPipe frame-to-frame
    landmark jitter WITHOUT flattening real velocity peaks the way a plain
    moving average does. Falls back to a moving average for very short series.
    """
    from scipy.signal import savgol_filter

    n = x.shape[0]
    if n < window + 2:
        return moving_average(x, 3)
    w = window if window % 2 == 1 else window + 1
    w = min(w, n if n % 2 == 1 else n - 1)
    if w <= order:
        return moving_average(x, 3)
    return savgol_filter(x, window_length=w, polyorder=order, axis=0, mode="nearest")


def moving_average(x: np.ndarray, window: int = 5) -> np.ndarray:
    """Centered moving average along axis 0; edge-padded so shape is preserved."""
    if window <= 1 or x.shape[0] < 3:
        return x.copy()
    window = min(window, x.shape[0] if x.shape[0] % 2 == 1 else x.shape[0] - 1)
    if window % 2 == 0:
        window += 1
    pad = window // 2
    if x.ndim == 1:
        xp = np.pad(x, (pad, pad), mode="edge")
        kernel = np.ones(window) / window
        return np.convolve(xp, kernel, mode="valid")
    out = np.empty_like(x)
    for col in range(x.shape[1]):
        out[:, col] = moving_average(x[:, col], window)
    return out


# Normalization
@dataclass
class NormalizationResult:
    frames: np.ndarray          # (T, 33, 4) normalized
    scale: float                # divisor applied (player height estimate)
    pelvis_centers: np.ndarray  # (T, 3) original pelvis centers (pre-centering)


class PoseNormalizer:
    """
    Scales coordinates relative to the player's height and re-centers the
    coordinate space on the pelvis (mid-hip) so swings recorded at different
    camera distances / offsets are directly comparable.

    Height estimate = median over frames of:
        |mid_ankle -> mid_hip| + |mid_hip -> mid_shoulder| + |mid_shoulder -> head|

    Y is flipped so +y points UP after normalization (raw MediaPipe has +y down).

    NOTE on centering: the pelvis center is computed ONCE from the setup
    (first) frame region and subtracted from every frame. Subtracting the
    per-frame pelvis would erase hip sway / early extension — exactly the
    signals we need to measure.
    """

    def __init__(self, setup_frames: int = 5) -> None:
        self.setup_frames = max(1, setup_frames)

    def height_estimate(self, frames: np.ndarray) -> float:
        mid_ankle = midpoint_series(frames, LEFT_ANKLE, RIGHT_ANKLE)
        mid_hip = midpoint_series(frames, LEFT_HIP, RIGHT_HIP)
        mid_shoulder = midpoint_series(frames, LEFT_SHOULDER, RIGHT_SHOULDER)
        head = frames[:, NOSE, :3]
        legs = np.linalg.norm(mid_hip - mid_ankle, axis=1)
        torso = np.linalg.norm(mid_shoulder - mid_hip, axis=1)
        neck = np.linalg.norm(head - mid_shoulder, axis=1)
        h = float(np.median(legs + torso + neck))
        return max(h, EPS)

    def normalize(self, frames: np.ndarray) -> NormalizationResult:
        frames = np.asarray(frames, dtype=np.float64)
        if frames.ndim != 3 or frames.shape[1] != 33 or frames.shape[2] != 4:
            raise ValueError(f"expected (T, 33, 4) pose array, got {frames.shape}")

        pelvis = midpoint_series(frames, LEFT_HIP, RIGHT_HIP)  # (T, 3)
        scale = self.height_estimate(frames)
        anchor = pelvis[: self.setup_frames].mean(axis=0)      # setup-frame pelvis

        out = frames.copy()
        out[:, :, :3] = (frames[:, :, :3] - anchor) / scale
        out[:, :, 1] *= -1.0  # flip: +y is now up
        return NormalizationResult(frames=out, scale=scale, pelvis_centers=pelvis)


# Per-frame metric extraction
@dataclass
class SwingMetrics:
    """Time-series metrics for one swing. All arrays have length T."""
    spine_angle_deg: np.ndarray        # trunk vs ground plane (90 = vertical)
    spine_delta_deg: np.ndarray        # |theta_t - theta_0|: posture CHANGE from address
    lead_arm_angle_deg: np.ndarray     # elbow interior angle (180 = dead straight)
    hip_sway: np.ndarray               # signed lateral pelvis displacement (height units)
    hip_thrust: np.ndarray             # signed toward-ball pelvis displacement (height units)
    hip_rotation_deg: np.ndarray       # pelvis line rotation in the horizontal plane
    shoulder_rotation_deg: np.ndarray  # shoulder line rotation in the horizontal plane
    wrist_speed: np.ndarray            # lead-wrist speed (height units / frame)
    kinematic_velocity: Dict[str, np.ndarray] = field(default_factory=dict)  # segment -> |deg/frame| series

    def as_feature_matrix(self) -> np.ndarray:
        """
        (T, F) matrix used as the DTW cost-space embedding. Each column is
        z-scored so no single metric dominates the Euclidean distance.
        """
        cols = [
            self.spine_angle_deg,
            self.lead_arm_angle_deg,
            self.hip_rotation_deg,
            self.shoulder_rotation_deg,
            self.hip_sway,
            self.wrist_speed,
        ]
        m = np.stack(cols, axis=1)
        mu = m.mean(axis=0, keepdims=True)
        sd = m.std(axis=0, keepdims=True)
        sd[sd < EPS] = 1.0
        return (m - mu) / sd


def _segment_angular_speed(line_vec: np.ndarray, plane: str = "xz") -> np.ndarray:
    """
    Angular speed (deg/frame) of a rotating body line.

    plane="xz": horizontal plane — correct for pelvis/thorax ROTATION.
    plane="xy": swing (vertical) plane — correct for the arm/club assembly,
    which swings up-and-down far more than it rotates about the vertical axis.
    Projecting arms onto the horizontal plane yields noise-dominated angles
    and phantom peaks (a V1 false-positive source).
    """
    a = line_vec[:, 0]
    b = line_vec[:, 2] if plane == "xz" else line_vec[:, 1]
    ang = np.unwrap(np.arctan2(b, a))
    return np.abs(np.gradient(np.degrees(ang)))


def compute_metrics(frames: np.ndarray, lead_side: str = "left") -> SwingMetrics:
    """
    frames: normalized (T, 33, 4) array (from PoseNormalizer.normalize).
    lead_side: "left" for a right-handed golfer, "right" for a lefty.
    """
    if lead_side not in ("left", "right"):
        raise ValueError("lead_side must be 'left' or 'right'")
    L = lead_side == "left"
    sh = LEFT_SHOULDER if L else RIGHT_SHOULDER
    el = LEFT_ELBOW if L else RIGHT_ELBOW
    wr = LEFT_WRIST if L else RIGHT_WRIST

    T = frames.shape[0]
    mid_hip = midpoint_series(frames, LEFT_HIP, RIGHT_HIP)
    mid_shoulder = midpoint_series(frames, LEFT_SHOULDER, RIGHT_SHOULDER)

    # --- Spine angle retention -------------------------------------------
    # Vector mid-hip -> mid-shoulder (the trunk) vs the ground plane.
    # Angle to plane = 90deg - angle(trunk, plane normal). Normal = +y (up).
    up = np.array([0.0, 1.0, 0.0])
    trunk = mid_shoulder - mid_hip
    # Angle between trunk and the up axis, mapped so 90deg = perfectly vertical
    # trunk and 0deg = trunk lying in the ground plane.
    spine_angle = np.array([angle_between(t, up) for t in trunk])
    spine_angle = 90.0 - np.minimum(spine_angle, 90.0)

    # --- Lead arm extension ----------------------------------------------
    lead_arm = np.array(
        [joint_angle_3d(frames[t, sh, :3], frames[t, el, :3], frames[t, wr, :3]) for t in range(T)]
    )

    # --- Hip sway (lateral) & thrust (toward ball) ------------------------
    hip_sway = mid_hip[:, 0] - mid_hip[0, 0]     # +x = toward target
    hip_thrust = mid_hip[:, 2] - mid_hip[0, 2]   # +z = toward ball/camera

    # --- Rotations in the horizontal plane --------------------------------
    hip_line = vector_series(frames, RIGHT_HIP, LEFT_HIP)
    sho_line = vector_series(frames, RIGHT_SHOULDER, LEFT_SHOULDER)

    def plane_rotation(line: np.ndarray) -> np.ndarray:
        raw = np.degrees(np.unwrap(np.arctan2(line[:, 2], line[:, 0])))
        return raw - raw[0]

    hip_rot = plane_rotation(hip_line)
    sho_rot = plane_rotation(sho_line)

    # --- Lead wrist speed -------------------------------------------------
    wrist_pos = frames[:, wr, :3]
    wrist_speed = np.linalg.norm(np.gradient(wrist_pos, axis=0), axis=1)

    # --- Kinematic angular-velocity series --------------------------------
    # Coordinates are Savitzky-Golay smoothed BEFORE the temporal derivative
    # so MediaPipe jitter can't produce phantom velocity spikes; peak ordering
    # (hips -> torso -> arms -> hands) is evaluated later inside the downswing
    # window only (see kinematic_sequence_report).
    arm_vec = vector_series(frames, sh, el)
    hand_vec = vector_series(frames, el, wr)
    # SavGol runs twice: on the raw line vectors (kills positional jitter
    # before the angle derivative) and on the resulting velocity series
    # (kills residual angle noise on short segments) — the double pass keeps
    # true peaks sharp while making peak ORDER robust to sensor noise.
    kinematic_velocity = {
        "hips": savgol_smooth(_segment_angular_speed(savgol_smooth(hip_line), "xz"), 7),
        "torso": savgol_smooth(_segment_angular_speed(savgol_smooth(sho_line), "xz"), 7),
        "arms": savgol_smooth(_segment_angular_speed(savgol_smooth(arm_vec), "xy"), 7),
        "hands": savgol_smooth(_segment_angular_speed(savgol_smooth(hand_vec), "xy"), 7),
    }

    # --- Spine-angle retention (posture delta from address) ---------------
    # theta_0 is the median spine angle over the first few (address) frames;
    # the retention series is |theta_t - theta_0| — a tour pro bent 30deg over
    # the ball scores ~0 all swing long, because we track CHANGE, not the raw
    # global angle.
    spine_smoothed = savgol_smooth(spine_angle)
    theta0 = float(np.median(spine_smoothed[: max(3, T // 15)]))
    spine_delta = np.abs(spine_smoothed - theta0)

    return SwingMetrics(
        spine_angle_deg=spine_smoothed,
        spine_delta_deg=spine_delta,
        lead_arm_angle_deg=savgol_smooth(lead_arm),
        hip_sway=savgol_smooth(hip_sway),
        hip_thrust=savgol_smooth(hip_thrust),
        hip_rotation_deg=savgol_smooth(hip_rot),
        shoulder_rotation_deg=savgol_smooth(sho_rot),
        wrist_speed=savgol_smooth(wrist_speed),
        kinematic_velocity=kinematic_velocity,
    )


# Deviation matrix (user vs pro along a DTW path)
@dataclass
class DeviationFrame:
    user_frame: int
    pro_frame: int
    spine_angle_delta: float
    lead_arm_delta: float
    hip_sway_delta: float
    hip_thrust_delta: float
    hip_rotation_delta: float
    flagged_joints: List[int]


# Thresholds (degrees, or normalized height units for translations)
SPINE_ANGLE_THRESHOLD_DEG = 8.0
LEAD_ARM_THRESHOLD_DEG = 20.0
HIP_SWAY_THRESHOLD = 0.055        # ~2.5 in for a 6 ft player (0.055 * 72in ≈ 4in incl. noise margin)
HIP_THRUST_THRESHOLD = 0.045      # early-extension trigger
HIP_ROTATION_THRESHOLD_DEG = 15.0


def deviation_matrix(
    user: SwingMetrics,
    pro: SwingMetrics,
    path: Sequence[Tuple[int, int]],
    lead_side: str = "left",
) -> List[DeviationFrame]:
    """
    Walk the DTW warp path and diff each aligned metric pair. Joints whose
    parent metric exceeds threshold are flagged for the UI to paint amber/red.
    """
    L = lead_side == "left"
    lead_elbow = LEFT_ELBOW if L else RIGHT_ELBOW
    lead_wrist = LEFT_WRIST if L else RIGHT_WRIST
    out: List[DeviationFrame] = []
    for ui, pi in path:
        ui = int(np.clip(ui, 0, len(user.spine_angle_deg) - 1))
        pi = int(np.clip(pi, 0, len(pro.spine_angle_deg) - 1))
        # Compare posture RETENTION (change-from-address) rather than raw
        # global angles — two golfers with different address postures should
        # not register a deviation just for setting up differently.
        spine_d = float(user.spine_delta_deg[ui] - pro.spine_delta_deg[pi])
        arm_d = float(user.lead_arm_angle_deg[ui] - pro.lead_arm_angle_deg[pi])
        sway_d = float(user.hip_sway[ui] - pro.hip_sway[pi])
        thrust_d = float(user.hip_thrust[ui] - pro.hip_thrust[pi])
        rot_d = float(user.hip_rotation_deg[ui] - pro.hip_rotation_deg[pi])

        flagged: List[int] = []
        if abs(spine_d) > SPINE_ANGLE_THRESHOLD_DEG:
            flagged += [LEFT_HIP, RIGHT_HIP, LEFT_SHOULDER, RIGHT_SHOULDER]
        if arm_d < -LEAD_ARM_THRESHOLD_DEG:
            flagged += [lead_elbow, lead_wrist]
        if abs(sway_d) > HIP_SWAY_THRESHOLD:
            flagged += [LEFT_HIP, RIGHT_HIP]
        out.append(
            DeviationFrame(
                user_frame=ui,
                pro_frame=pi,
                spine_angle_delta=spine_d,
                lead_arm_delta=arm_d,
                hip_sway_delta=sway_d,
                hip_thrust_delta=thrust_d,
                hip_rotation_delta=rot_d,
                flagged_joints=sorted(set(flagged)),
            )
        )
    return out


def kinematic_sequence_report(
    metrics: SwingMetrics,
    downswing_start: int,
    impact: int,
) -> Dict[str, object]:
    """
    Verify hips -> torso -> arms -> hands peak-velocity ordering, evaluated
    ONLY inside the downswing window [top_of_backswing, impact + margin].
    Peaks elsewhere (waggle at address, recoil in the finish) are coaching
    noise and must not flag a fault.
    """
    order = ["hips", "torso", "arms", "hands"]
    T = len(metrics.spine_angle_deg)
    lo = int(np.clip(downswing_start, 0, T - 2))
    hi = int(np.clip(impact + max(2, T // 20), lo + 2, T))
    peaks: Dict[str, int] = {}
    for k in order:
        vel = metrics.kinematic_velocity.get(k)
        if vel is None or len(vel) == 0:
            peaks[k] = lo
            continue
        window = np.asarray(vel[lo:hi], dtype=np.float64)
        vmax = float(np.max(window))
        if vmax <= EPS:
            peaks[k] = lo
            continue
        # Peak time = centroid of the top-30% velocity mass. A raw argmax on a
        # broad/plateau peak jumps frames under sensor noise; the centroid of
        # the high-velocity region is stable.
        mask = window >= 0.7 * vmax
        t_idx = np.arange(len(window), dtype=np.float64)
        peaks[k] = lo + int(round(float(np.sum(t_idx[mask] * window[mask]) / np.sum(window[mask]))))
    frames = [peaks[k] for k in order]
    # Tie tolerance: at 30 fps, peaks within ~2 frames are indistinguishable —
    # only flag when a later segment peaks CLEARLY before an earlier one.
    tol = max(2, T // 30)
    correct = all(frames[i + 1] >= frames[i] - tol for i in range(len(frames) - 1))
    return {
        "order": order,
        "peak_frames": peaks,
        "sequence_correct": correct,
        "window": {"start": lo, "end": hi - 1},
        "tolerance_frames": tol,
    }
