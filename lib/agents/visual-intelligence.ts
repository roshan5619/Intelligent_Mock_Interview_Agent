/**
 * Agent 4 — Visual Intelligence (server scoring half)
 *
 * The browser side (lib/vision/*) does ALL the heavy lifting using
 * MediaPipe Tasks (FaceLandmarker, FaceBlendshapes, PoseLandmarker) entirely
 * on-device. Per the spec we PREFER pretrained CV over LLMs for vision.
 *
 * Server side just translates the per-turn aggregated VisualMetrics into:
 *   - engagement_score      (0-1)
 *   - stress_indicator      (0-1)
 *   - eye_contact_ratio     (0-1, passthrough)
 *   - posture_score         (0-1, passthrough)
 *
 * Pure deterministic math — no LLM call. Cheap, predictable, always available.
 * (We can add an LLM-generated *explanation* of these metrics in the report
 * via the Feedback agent, but the SCORES themselves are computed here.)
 */
import type { VisualMetrics } from '@/lib/storage/types';

export type VisualScore = {
  engagement_score: number;
  stress_indicator: number;
  eye_contact_ratio: number;
  posture_score: number;
  signals_summary: string;
};

export function scoreVisual(m: VisualMetrics): VisualScore {
  // Engagement: weighted combination of eye contact + expression + steady head
  // pose. Baseline 0.5 so a perfectly neutral face still scores reasonably.
  const engagement = clamp(
    0.5 +
      0.25 * (m.eye_contact_ratio - 0.5) +
      0.15 * (m.smile_intensity_mean + m.brow_raise_mean) +
      0.10 * (m.head_pose_stability - 0.5),
    0,
    1
  );

  // Stress: high jaw tension + low eye contact + erratic head pose.
  const stress = clamp(
    0.5 * m.jaw_tension_mean +
      0.3 * (1 - m.eye_contact_ratio) +
      0.2 * (1 - m.head_pose_stability),
    0,
    1
  );

  return {
    engagement_score: round2(engagement),
    stress_indicator: round2(stress),
    eye_contact_ratio: round2(clamp(m.eye_contact_ratio, 0, 1)),
    posture_score: round2(clamp(m.posture_score, 0, 1)),
    signals_summary: summarize(m, engagement, stress),
  };
}

function summarize(
  m: VisualMetrics,
  engagement: number,
  stress: number
): string {
  const parts: string[] = [];
  if (m.eye_contact_ratio < 0.3) parts.push('low eye contact');
  else if (m.eye_contact_ratio > 0.7) parts.push('strong eye contact');
  if (m.posture_score < 0.4) parts.push('slouched posture');
  if (stress > 0.7) parts.push('elevated stress signals');
  if (engagement > 0.7) parts.push('engaged expression');
  if (m.head_pose_stability < 0.3) parts.push('fidgety head movement');
  return parts.length === 0 ? 'neutral on-camera presence' : parts.join('; ');
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
