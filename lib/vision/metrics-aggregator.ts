/**
 * VisionMetricsAggregator — collects per-frame face + pose signals during a
 * candidate's turn, then rolls them up into a single VisualMetrics blob.
 *
 * Lifecycle:
 *   const agg = new VisionMetricsAggregator();
 *   agg.calibrateEyeContactBaseline();   // optional, during 30s warmup
 *   // ... per frame:
 *   agg.observeFace(faceResult);
 *   agg.observePose(poseResult);
 *   // when the candidate is done speaking:
 *   const metrics = agg.flush();         // returns VisualMetrics + resets
 */
import type {
  FaceLandmarkerResult,
  PoseLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type { VisualMetrics } from '@/lib/storage/types';

/* ---------- helpers shared across this file ---------- */

const BLINK_BLENDSHAPE_THRESHOLD = 0.55;
const SMILE_NAMES = new Set(['mouthSmileLeft', 'mouthSmileRight']);
const FROWN_NAMES = new Set(['mouthFrownLeft', 'mouthFrownRight']);
const BROW_RAISE_NAMES = new Set([
  'browInnerUp',
  'browOuterUpLeft',
  'browOuterUpRight',
]);
const JAW_TENSION_NAMES = new Set([
  'jawOpen',
  'mouthPressLeft',
  'mouthPressRight',
]);
const EYE_BLINK_NAMES = new Set(['eyeBlinkLeft', 'eyeBlinkRight']);

export class VisionMetricsAggregator {
  private framesAnalyzed = 0;

  // Eye contact: count frames where the face is roughly centered + facing forward
  private eyeContactFrames = 0;

  // Head pose stability: track mean + variance of nose-tip x,y across frames
  private noseXs: number[] = [];
  private noseYs: number[] = [];

  // Posture: derived from shoulder y-symmetry + head-shoulder distance ratio
  private postureSamples: number[] = [];

  // Blendshape time series
  private smileSeries: number[] = [];
  private browRaiseSeries: number[] = [];
  private jawTensionSeries: number[] = [];

  // Blink detection (peak-counting on eyeBlink blendshapes)
  private lastBlinkTs = 0;
  private blinkCount = 0;
  private inBlink = false;

  private startTs = Date.now();
  private eyeContactBaselineX: number | null = null;

  /** Optional: capture the candidate's natural face position during warmup. */
  calibrateEyeContactBaseline(noseX: number) {
    this.eyeContactBaselineX = noseX;
  }

  observeFace(result: FaceLandmarkerResult) {
    this.framesAnalyzed++;
    const lm = result.faceLandmarks?.[0];
    if (lm && lm.length > 1) {
      // Use landmark 1 (nose tip) for head-pose proxy
      const nose = lm[1];
      this.noseXs.push(nose.x);
      this.noseYs.push(nose.y);

      // Eye contact heuristic: nose roughly centered (0.4..0.6) AND close
      // enough to the calibrated baseline (within 0.08 normalized units).
      const xCentered = nose.x > 0.4 && nose.x < 0.6;
      const closeToBaseline =
        this.eyeContactBaselineX === null ||
        Math.abs(nose.x - this.eyeContactBaselineX) < 0.08;
      if (xCentered && closeToBaseline) this.eyeContactFrames++;
    }

    const blends = result.faceBlendshapes?.[0]?.categories;
    if (blends) {
      let smile = 0;
      let frown = 0;
      let brow = 0;
      let jaw = 0;
      let blink = 0;
      for (const c of blends) {
        if (SMILE_NAMES.has(c.categoryName)) smile = Math.max(smile, c.score);
        if (FROWN_NAMES.has(c.categoryName)) frown = Math.max(frown, c.score);
        if (BROW_RAISE_NAMES.has(c.categoryName)) brow = Math.max(brow, c.score);
        if (JAW_TENSION_NAMES.has(c.categoryName)) jaw = Math.max(jaw, c.score);
        if (EYE_BLINK_NAMES.has(c.categoryName)) blink = Math.max(blink, c.score);
      }
      // Net smile (positive expression) — frown subtracts
      this.smileSeries.push(Math.max(0, smile - frown * 0.5));
      this.browRaiseSeries.push(brow);
      this.jawTensionSeries.push(jaw);

      // Blink edge detection
      const now = Date.now();
      if (blink > BLINK_BLENDSHAPE_THRESHOLD && !this.inBlink) {
        this.inBlink = true;
        this.lastBlinkTs = now;
        this.blinkCount++;
      } else if (blink < BLINK_BLENDSHAPE_THRESHOLD * 0.7) {
        this.inBlink = false;
      }
    }
  }

  observePose(result: PoseLandmarkerResult) {
    const pose = result.landmarks?.[0];
    if (!pose || pose.length < 13) return;

    // Landmarks of interest:
    //   11 = left shoulder, 12 = right shoulder, 0 = nose
    const lShoulder = pose[11];
    const rShoulder = pose[12];
    const nose = pose[0];
    if (!lShoulder || !rShoulder || !nose) return;

    // Symmetry: shoulders should be roughly at the same y. Big delta = leaning.
    const shoulderYDelta = Math.abs(lShoulder.y - rShoulder.y);

    // Head-over-shoulders: nose x should be near the midpoint of shoulders.
    const midShoulderX = (lShoulder.x + rShoulder.x) / 2;
    const headOffset = Math.abs(nose.x - midShoulderX);

    // Crude posture score: 1 = perfectly upright + centered, 0 = collapsed.
    const symmetryScore = clamp(1 - shoulderYDelta * 6, 0, 1);
    const centeringScore = clamp(1 - headOffset * 3, 0, 1);
    this.postureSamples.push(0.5 * symmetryScore + 0.5 * centeringScore);
  }

  flush(): VisualMetrics {
    const noseStability = stabilityScore(this.noseXs, this.noseYs);
    const eyeContactRatio =
      this.framesAnalyzed === 0
        ? 0.5
        : this.eyeContactFrames / this.framesAnalyzed;
    const posture =
      this.postureSamples.length === 0 ? 0.6 : mean(this.postureSamples);
    const smile = mean(this.smileSeries);
    const brow = mean(this.browRaiseSeries);
    const jaw = mean(this.jawTensionSeries);
    const elapsedMin = (Date.now() - this.startTs) / 60_000;
    const blinkRate = elapsedMin > 0 ? this.blinkCount / elapsedMin : 0;

    const metrics: VisualMetrics = {
      eye_contact_ratio: round2(clamp(eyeContactRatio, 0, 1)),
      head_pose_stability: round2(clamp(noseStability, 0, 1)),
      posture_score: round2(clamp(posture, 0, 1)),
      smile_intensity_mean: round2(smile),
      brow_raise_mean: round2(brow),
      jaw_tension_mean: round2(jaw),
      blink_rate_per_min: round1(blinkRate),
      frames_analyzed: this.framesAnalyzed,
    };

    // Reset for next turn
    this.framesAnalyzed = 0;
    this.eyeContactFrames = 0;
    this.noseXs = [];
    this.noseYs = [];
    this.postureSamples = [];
    this.smileSeries = [];
    this.browRaiseSeries = [];
    this.jawTensionSeries = [];
    this.blinkCount = 0;
    this.startTs = Date.now();

    return metrics;
  }
}

/* ----- helpers ----- */

function mean(a: number[]): number {
  return a.length === 0 ? 0 : a.reduce((s, n) => s + n, 0) / a.length;
}

function stabilityScore(xs: number[], ys: number[]): number {
  if (xs.length < 3) return 0.5;
  const mx = mean(xs);
  const my = mean(ys);
  const vx = mean(xs.map((x) => (x - mx) ** 2));
  const vy = mean(ys.map((y) => (y - my) ** 2));
  // Low variance → high stability. Scale: variance of 0.005 → ~stability 0.7
  const total = vx + vy;
  return clamp(1 - total * 100, 0, 1);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
