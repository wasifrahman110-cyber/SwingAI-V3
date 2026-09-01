/**
 * HomeScreen — "Good Morning" dashboard: performance stat cards, weekly
 * framework-score chart with goal marker, and the framework honeycomb map.
 */

import type { AnalysisResult, PhaseName, SessionRecord } from "../types/pose.ts";
import { FaultTrendDashboard } from "./FaultTrendDashboard.tsx";
import type { DashboardData } from "../lib/demoData.ts";
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
  return (
    <div className="screen">
      <div className="statusbar">
        <span>9:41</span>
        <span className="glyphs" aria-hidden>
          <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor">
            <rect x="0" y="7" width="3" height="4" rx="0.8" />
            <rect x="4.5" y="5" width="3" height="6" rx="0.8" />
            <rect x="9" y="2.5" width="3" height="8.5" rx="0.8" />
            <rect x="13.5" y="0" width="3" height="11" rx="0.8" />
          </svg>
          <svg width="22" height="11" viewBox="0 0 24 12" fill="none" stroke="currentColor">
            <rect x="0.5" y="0.5" width="20" height="11" rx="3" strokeWidth="1" opacity="0.5" />
            <rect x="2" y="2" width="15" height="8" rx="1.6" fill="currentColor" stroke="none" />
            <path d="M22.5 4v4" strokeWidth="1.4" strokeLinecap="round" opacity="0.5" />
          </svg>
        </span>
      </div>

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
            {idx.toFixed(1)}
            <span className={`delta-up ${dashboard.swingIndexDelta >= 0 ? "good" : ""}`}>
              {dashboard.swingIndexDelta >= 0 ? "▲" : "▼"}{" "}
              {Math.abs(dashboard.swingIndexDelta).toFixed(1)}
            </span>
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
          <span className="pill accent">goal {dashboard.goal.toFixed(1)}</span>
        </div>
        <FrameworkScoreChart
          series={dashboard.scoreSeries}
          goal={dashboard.goal}
          dayLabels={dashboard.dayLabels}
        />
        <div className="range">{dashboard.weekLabel}</div>
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
