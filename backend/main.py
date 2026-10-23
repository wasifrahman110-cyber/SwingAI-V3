"""
SwingAI FastAPI service.

POST /api/analyze
    Body: user + pro landmark sequences (T x 33 x [x, y, z, visibility]).
    Returns: DTW warp path, phase checkpoints, per-frame deviation matrix,
             detected faults, and markdown drill cards.

Run:  uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

from dataclasses import asdict
from typing import List, Literal

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from analytics.dtw_aligner import align_swings, phase_aligned_checkpoints, segment_phases
from analytics.drills import detect_faults, recommend_drills
from analytics.metrics import (
    PoseNormalizer,
    compute_metrics,
    deviation_matrix,
    kinematic_sequence_report,
)

app = FastAPI(title="SwingAI Analytics Engine", version="1.0.0")

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
    pro_swing: SwingUpload


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
    return {"status": "ok", "engine": "swingai-analytics", "version": "1.0.0"}


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest) -> dict:
    try:
        normalizer = PoseNormalizer()
        user_norm = normalizer.normalize(_to_array(req.user_swing))
        pro_norm = normalizer.normalize(_to_array(req.pro_swing))

        lead = req.user_swing.lead_side
        user_metrics = compute_metrics(user_norm.frames, lead_side=lead)
        pro_metrics = compute_metrics(pro_norm.frames, lead_side=req.pro_swing.lead_side)

        user_phases = segment_phases(user_norm.frames, lead_side=lead)
        pro_phases = segment_phases(pro_norm.frames, lead_side=req.pro_swing.lead_side)

        dtw = align_swings(user_metrics, pro_metrics)
        deviations = deviation_matrix(user_metrics, pro_metrics, dtw.path, lead_side=lead)
        faults = detect_faults(user_metrics, pro_metrics, user_phases, deviations)
        drills = recommend_drills(faults)

        return {
            "alignment": {
                "path": dtw.path,
                "cost": dtw.cost,
                "normalized_cost": dtw.normalized_cost,
                "user_to_pro": dtw.user_to_pro.tolist(),
                "pro_to_user": dtw.pro_to_user.tolist(),
            },
            "phases": {
                "user": user_phases.as_dict(),
                "pro": pro_phases.as_dict(),
                "aligned": phase_aligned_checkpoints(user_phases, pro_phases, dtw),
            },
            "kinematic_sequence": kinematic_sequence_report(user_metrics),
            "deviations": [asdict(d) for d in deviations],
            "faults": [asdict(f) for f in faults],
            "drills": [
                {"fault_code": d.fault.code, "drill_name": d.drill_name, "markdown": d.markdown}
                for d in drills
            ],
            "swing_index": _swing_index(dtw.normalized_cost, len(faults)),
        }
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _swing_index(normalized_cost: float, fault_count: int) -> float:
    """
    0–10 composite: DTW similarity (tempo + shape) minus fault penalties.
    normalized_cost ~ 0 (identical) … ~4+ (nothing alike).
    """
    base = 10.0 * float(np.exp(-max(0.0, normalized_cost - 0.6) / 2.2))
    penalized = base - 0.6 * fault_count
    return round(float(np.clip(penalized, 0.0, 10.0)), 1)
