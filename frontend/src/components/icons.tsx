/** Minimal inline icon set (stroke-based, 24px grid). */

interface IconProps {
  size?: number;
  strokeWidth?: number;
}

const base = (size: number) =>
  ({
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  }) as const;

export const ChevronLeft = ({ size = 22, strokeWidth = 2.2 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

export const ChevronUp = ({ size = 18, strokeWidth = 2.2 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M6 15l6-6 6 6" />
  </svg>
);

export const Kebab = ({ size = 20, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <circle cx="12" cy="5" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="19" r="1" fill="currentColor" />
  </svg>
);

export const Play = ({ size = 30 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5.5v13l11-6.5z" />
  </svg>
);

export const Pause = ({ size = 30 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <rect x="7" y="5" width="3.4" height="14" rx="1" />
    <rect x="13.6" y="5" width="3.4" height="14" rx="1" />
  </svg>
);

export const Bookmark = ({ size = 19, strokeWidth = 1.9 }: IconProps & { filled?: boolean }) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M6 4h12v17l-6-4.5L6 21z" />
  </svg>
);

export const BookmarkFilled = ({ size = 19 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 4h12v17l-6-4.5L6 21z" />
  </svg>
);

export const Home = ({ size = 24, strokeWidth = 1.9 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M4 10.5L12 4l8 6.5V20a1 1 0 01-1 1h-5v-6h-4v6H5a1 1 0 01-1-1z" />
  </svg>
);

export const Book = ({ size = 24, strokeWidth = 1.9 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z" />
    <path d="M4 19a2 2 0 012-2h13" />
  </svg>
);

export const PlayerNav = ({ size = 24, strokeWidth = 1.9 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="M10 9.5v5l4.5-2.5z" fill="currentColor" stroke="none" />
  </svg>
);

export const Chart = ({ size = 24, strokeWidth = 1.9 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M4 19h16" />
    <path d="M7 19v-6M12 19V6M17 19v-9" />
  </svg>
);

export const Plus = ({ size = 26, strokeWidth = 2.4 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const Golfer = ({ size = 20, strokeWidth = 1.7 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <circle cx="13.5" cy="4.5" r="2" />
    <path d="M13 8l-3 4 2.5 3.5V21" />
    <path d="M13 8l4 1.5" />
    <path d="M10 12l-3.5 2" />
    <path d="M17.5 3v18" opacity="0.5" />
  </svg>
);

export const Target = ({ size = 16, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const CheckBadge = ({ size = 16, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 12.5l2.5 2.5 4.5-5" />
  </svg>
);
