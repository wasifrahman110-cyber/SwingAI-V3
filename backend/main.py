"""
SwingAI FastAPI service (V2).

POST /api/analyze
    Body: user landmark sequence, plus an OPTIONAL reference ("pro") sequence.
    - Solo mode (no reference): phases, kinematics, faults, drills, solo index.
    - Dual mode: everything above plus DTW warp path, aligned checkpoints,
      and the reference-relative deviation matrix.

Run:  uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

from dataclasses import asdict
from typing import List, Literal, Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from analytics.biomechanics import detect_faults
from analytics.dtw_aligner import align_swings, phase_aligned_checkpoints, segment_phases
from analytics.drills import recommend_drills
from analytics.metrics import (
    PoseNormalizer,
    compute_metrics,
    deviation_matrix,
    kinematic_sequence_report,
)

app = FastAPI(title="SwingAI Analytics Engine", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class Landmark(BaseModel):
    x: float
    y: float
    z: float
    visibility: float = Field(ge=0.0, le=1.0, default=1.0)


class SwingUpload(BaseModel):
    fps: float = Field(gt=0, le=480, default=30.0)
    lead_side: Literal["left", "right"] = "left"
    frames: List[List[Landmark]]

    @field_validator("frames")
    @classmethod
    def _check_shape(cls, v: List[List[Landmark]]) -> List[List[Landmark]]:
        if len(v) < 10:
            raise ValueError("a swing needs at least 10 frames")
        for i, frame in enumerate(v):
            if len(frame) != 33:
                raise ValueError(f"frame {i} has {len(frame)} landmarks, expected 33")
        return v


class AnalyzeRequest(BaseModel):
    user_swing: SwingUpload
    pro_swing: Optional[SwingUpload] = None  # omit for single-swing mode


def _to_array(swing: SwingUpload) -> np.ndarray:
    return np.array(
        [[[lm.x, lm.y, lm.z, lm.visibility] for lm in frame] for frame in swing.frames],
        dtype=np.float64,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "engine": "swingai-analytics", "version": "2.0.0"}


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest) -> dict:
    try:
        normalizer = PoseNormalizer()
        user_norm = normalizer.normalize(_to_array(req.user_swing))
        lead = req.user_swing.lead_side
        user_metrics = compute_metrics(user_norm.frames, lead_side=lead)
        user_phases = segment_phases(user_norm.frames, lead_side=lead)

        # Faults are fully self-referential (posture deltas from the golfer's
        # own address) — identical results with or without a reference swing.
        faults = detect_faults(user_norm.frames, user_metrics, user_phases, lead_side=lead)
        drills = recommend_drills(faults)
        kin = kinematic_sequence_report(
            user_metrics, user_phases.top_of_backswing, user_phases.impact
        )

        payload: dict = {
            "mode": "dual" if req.pro_swing is not None else "solo",
            "phases": {"user": user_phases.as_dict()},
            "kinematic_sequence": kin,
            "kinematic_velocity": {
                k: v.tolist() for k, v in user_metrics.kinematic_velocity.items()
            },
            "spine_delta_deg": user_metrics.spine_delta_deg.tolist(),
            "faults": [asdict(f) for f in faults],
            "drills": [
                {
                    "fault_code": d.fault.code,
                    "drill_name": d.drill_name,
                    "markdown": d.markdown,
                    "title": d.title,
                    "description": d.description,
                    "focus_key": d.focus_key,
                    "recommended_reps": d.recommended_reps,
                }
                for d in drills
            ],
        }

        if req.pro_swing is None:
            payload["alignment"] = None
            payload["deviations"] = []
            payload["swing_index"] = _solo_swing_index(faults)
            return payload

        pro_norm = normalizer.normalize(_to_array(req.pro_swing))
        pro_metrics = compute_metrics(pro_norm.frames, lead_side=req.pro_swing.lead_side)
        pro_phases = segment_phases(pro_norm.frames, lead_side=req.pro_swing.lead_side)
        dtw = align_swings(user_metrics, pro_metrics)
        deviations = deviation_matrix(user_metrics, pro_metrics, dtw.path, lead_side=lead)

        payload["alignment"] = {
            "path": dtw.path,
            "cost": dtw.cost,
            "normalized_cost": dtw.normalized_cost,
            "user_to_pro": dtw.user_to_pro.tolist(),
            "pro_to_user": dtw.pro_to_user.tolist(),
        }
        payload["phases"]["pro"] = pro_phases.as_dict()
        payload["phases"]["aligned"] = phase_aligned_checkpoints(user_phases, pro_phases, dtw)
        payload["deviations"] = [asdict(d) for d in deviations]
        payload["swing_index"] = _dual_swing_index(dtw.normalized_cost, len(faults))
        return payload
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _dual_swing_index(normalized_cost: float, fault_count: int) -> float:
    """0-10: DTW similarity to the reference minus fault penalties."""
    base = 10.0 * float(np.exp(-max(0.0, normalized_cost - 0.6) / 2.2))
    return round(float(np.clip(base - 0.6 * fault_count, 0.0, 10.0)), 1)


def _solo_swing_index(faults: list) -> float:
    """0-10 with no reference: start from 10, weight penalties by severity."""
    weights = {"critical": 1.6, "major": 1.1, "minor": 0.5}
    penalty = sum(weights.get(f.severity, 1.0) for f in faults)
    return round(float(np.clip(10.0 - penalty, 0.0, 10.0)), 1)
