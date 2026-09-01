/**
 * HexMap — the "framework" honeycomb from the reference UI: hexagonal chips
 * for each swing checkpoint, with the focus-fix cell highlighted in the
 * anomaly color and the count of active fixes.
 */

import type { AnalysisResult, PhaseName } from "../types/pose.ts";
import { PHASE_LABELS } from "../types/pose.ts";

interface HexMapProps {
  analysis: AnalysisResult | null;
  onOpenPhase: (phase: PhaseName) => void;
}

interface Cell {
  phase: PhaseName;
  line: number;
  cx: number;
  cy: number;
}

const R = 46; // hex circumradius

const CELLS: readonly Cell[] = [
  { phase: "setup", line: 0, cx: 210, cy: 64 },
  { phase: "top_of_backswing", line: 2, cx: 285, cy: 108 },
  { phase: "downswing", line: 5, cx: 135, cy: 108 },
  { phase: "impact", line: 6, cx: 210, cy: 152 },
  { phase: "follow_through", line: 8, cx: 285, cy: 196 },
];

const hexPath = (cx: number, cy: number, r: number): string => {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join("L")}Z`;
};

export function HexMap({ analysis, onOpenPhase }: HexMapProps) {
  const faultsByPhase = new Map<PhaseName, number>();
  if (analysis) {
    for (const f of analysis.faults) {
      faultsByPhase.set(f.phase, (faultsByPhase.get(f.phase) ?? 0) + 1);
    }
  }
  const focus = analysis?.faults[0]?.phase ?? null;

  return (
    <svg viewBox="0 0 420 260" role="img" aria-label="framework map">
      {CELLS.map((c) => {
        const count = faultsByPhase.get(c.phase) ?? 0;
        const isFocus = focus === c.phase;
        const fill = isFocus
          ? "rgba(224,86,75,0.16)"
          : count > 0
            ? "rgba(217,164,65,0.10)"
            : "#202025";
        const stroke = isFocus ? "#e0564b" : count > 0 ? "#d9a441" : "#2a2a30";
        return (
          <g
            key={c.phase}
            onClick={() => onOpenPhase(c.phase)}
            style={{ cursor: "pointer" }}
          >
            <path d={hexPath(c.cx, c.cy, R)} fill={fill} stroke={stroke} strokeWidth={1.4} />
            {isFocus && (
              <text
                x={c.cx}
                y={c.cy - 16}
                textAnchor="middle"
                fill="#e0564b"
                fontSize="9.5"
                fontWeight="700"
                fontFamily="Inter, sans-serif"
              >
                Focus Fix
              </text>
            )}
            <text
              x={c.cx}
              y={c.cy - 1}
              textAnchor="middle"
              fill="#8e8e96"
              fontSize="10"
              fontWeight="600"
              fontFamily="'JetBrains Mono', monospace"
            >
              {`Line ${c.line}`}
            </text>
            <text
              x={c.cx}
              y={c.cy + 15}
              textAnchor="middle"
              fill="#f5f5f7"
              fontSize="12.5"
              fontWeight="700"
              fontFamily="Inter, sans-serif"
            >
              {PHASE_LABELS[c.phase]}
            </text>
            {count > 0 && (
              <g>
                <circle cx={c.cx + R * 0.55} cy={c.cy - R * 0.55} r={9} fill={stroke} />
                <text
                  x={c.cx + R * 0.55}
                  y={c.cy - R * 0.55 + 3.5}
                  textAnchor="middle"
                  fill="#0b0b0d"
                  fontSize="10"
                  fontWeight="800"
                  fontFamily="Inter, sans-serif"
                >
                  {count}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
