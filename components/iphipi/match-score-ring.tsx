/**
 * MatchScoreRing — animated circular ring showing a 0-100 match score.
 * Pure SVG, no external animation lib needed (we animate via Tailwind).
 */
import { cn } from '@/lib/utils';

type Props = {
  score: number;       // 0..100
  size?: number;       // px
  className?: string;
};

export function MatchScoreRing({ score, size = 160, className }: Props) {
  const safe = Math.max(0, Math.min(100, score));
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (safe / 100) * circumference;
  const color = scoreColor(safe);

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={strokeWidth}
        />
        {/* Progress */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(0.4, 0, 0.2, 1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-4xl font-semibold tabular-nums tracking-tight text-foreground">
          {Math.round(safe)}
        </div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          fit score
        </div>
      </div>
    </div>
  );
}

function scoreColor(s: number): string {
  if (s >= 80) return '#34d399';   // emerald
  if (s >= 60) return '#5b67ff';   // brand
  if (s >= 40) return '#f59e0b';   // amber
  return '#ef4444';                 // red
}
