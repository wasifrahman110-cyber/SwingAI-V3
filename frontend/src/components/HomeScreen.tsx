/**
 * HomeScreen — "Good Morning" dashboard: performance stat cards, weekly
 * framework-score chart with goal marker, and the framework honeycomb map.
 */

import type { AnalysisResult, PhaseName, SessionRecord } from "../types/pose.ts";
import { FaultTrendDashboard } from "./FaultTrendDashboard.tsx";
import type { DashboardData } from "../lib/dashboard.ts";
import { FrameworkScoreChart } from "./FrameworkScoreChart.tsx";
import { HexMap } from "./HexMap.tsx";
import { CheckBadge, ChevronUp, Target } from "./icons.tsx";

interface HomeScreenProps {
  userName: string;
  dashboard: DashboardData;
  analysis: AnalysisResult | null;
  sessions: readonly SessionRecord[];
  onOpenSwing: (phase?: PhaseName) => void;
}

export function HomeScreen({ userName, dashboard, analysis, sessions, onOpenSwing }: HomeScreenProps) {
  const idx = analysis?.swingIndex ?? dashboard.swingIndex;
  const delta = dashboard.swingIndexDelta;
  const hasTrend = dashboard.scoreSeries.length >= 2;
  return (
    <div className="screen">
      <header className="home-header">
        <div className="avatar">{userName.slice(0, 1).toUpperCase()}</div>
        <div className="greeting">
          <div className="hello">Good Morning,</div>
          <div className="name">{userName}!</div>
        </div>
      </header>

      <h2 className="section-title">Your Performance</h2>

      <div className="stat-row">
        <button className="stat-card" onClick={() => onOpenSwing()}>
          <span className="icon-dot">
            <Target size={15} />
          </span>
          <span className="value">
            {idx === null ? "—" : idx.toFixed(1)}
            {delta !== null && (
              <span className={`delta-up ${delta >= 0 ? "good" : ""}`}>
                {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}
              </span>
            )}
          </span>
          <span className="label">
            Swing Index <span style={{ marginLeft: "auto" }}>›</span>
          </span>
        </button>
        <button className="stat-card" onClick={() => onOpenSwing()}>
          <span className="icon-dot">
            <CheckBadge size={15} />
          </span>
          <span className="value">{dashboard.analyzedCount}</span>
          <span className="label">
            Analyzed <span style={{ marginLeft: "auto" }}>›</span>
          </span>
        </button>
      </div>

      <div className="chart-card">
        <div className="chart-head">
          <span className="title">Framework Score</span>
          {hasTrend && <span className="pill accent">goal {dashboard.goal.toFixed(1)}</span>}
        </div>
        {hasTrend ? (
          <>
            <FrameworkScoreChart
              series={dashboard.scoreSeries}
              goal={dashboard.goal}
              dayLabels={dashboard.dayLabels}
            />
            <div className="range">{dashboard.weekLabel}</div>
          </>
        ) : (
          <div className="empty-note" style={{ padding: "18px 10px" }}>
            {dashboard.analyzedCount === 0
              ? "Analyze your first swing and your score trend starts here."
              : "One more swing and your score trend appears here."}
          </div>
        )}
      </div>

      <div className="hex-card">
        <div className="hex-head">
          <span className="t">
            Swing Framework{" "}
            <span style={{ color: "var(--muted)", transform: "rotate(90deg)", display: "inline-flex" }}>
              <ChevronUp size={15} />
            </span>
          </span>
          {analysis && analysis.faults.length > 0 && (
            <span className="pill">
              <span style={{ color: "var(--anomaly-red)" }}>●</span>
              {analysis.faults.length} active {analysis.faults.length === 1 ? "fix" : "fixes"}
            </span>
          )}
        </div>
        <HexMap analysis={analysis} onOpenPhase={(p) => onOpenSwing(p)} />
      </div>

      <FaultTrendDashboard sessions={sessions} />
    </div>
  );
}
