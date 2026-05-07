/**
 * TypeScript shapes for our database rows. Fields here mirror db/schema.sql.
 * Keep this file dependency-free.
 */

export type Candidate = {
  id: string;
  email: string | null;
  name: string | null;
  createdAt: number;
};

export type JobLevel = 'Junior' | 'Mid' | 'Senior' | 'Staff' | 'Lead' | 'Principal';

/** Structured JD — what Agent 1 matches against. */
export type JdStruct = {
  responsibilities: string[];
  must_haves: string[];
  nice_to_haves: string[];
  ideal_years_experience: { min: number; max: number };
  domains?: string[];
};

export type JdWeights = {
  /** must_haves count more than nice_to_haves */
  must_have_weight: number;
  nice_to_have_weight: number;
};

export type Job = {
  id: string;
  slug: string;
  title: string;
  department: string;
  level: JobLevel;
  location: string;
  jdMd: string;
  jdStruct: JdStruct;
  weights: JdWeights;
};

/** Output of Agent 1 (Context Understanding). */
export type ContextProfile = {
  skills: string[];
  years_total: number;
  roles: { title: string; org?: string; years?: number }[];
  projects: {
    name: string;
    summary: string;
    impact?: string;
    tech?: string[];
  }[];
  education: { degree: string; school?: string; year?: number }[];
  certs: string[];
  domains: string[];
  seniority_signals: string[];
  /** Inferred target roles, ranked. */
  inferred_roles: {
    role: string;
    confidence: number; // 0..1
    rationale: string;
    matched_evidence: string[];
  }[];
};

export type MatchBreakdown = {
  score: number; // 0..100
  embedding_similarity: number; // 0..1
  skill_overlap: number; // 0..1
  seniority_fit: number; // 0..1
  matched: string[];
  gaps: string[];
  rationale: string;
};

export type ApplicationStatus = 'parsing' | 'ready' | 'interviewing' | 'completed';

export type Application = {
  id: string;
  candidateId: string;
  jobId: string | null;
  resumeBlobUrl: string;
  resumeFilename: string;
  contextProfile: ContextProfile | null;
  matchScore: number | null;
  matchBreakdown: MatchBreakdown | null;
  status: ApplicationStatus;
  createdAt: number;
};

export type RoleMatchResult = {
  jobId: string;
  jobSlug: string;
  jobTitle: string;
  department: string;
  level: JobLevel;
  score: number;
  breakdown: MatchBreakdown;
  whyFitsMd: string;
};

export type RoleMatchRun = {
  id: string;
  candidateId: string;
  scoredAt: number;
  results: RoleMatchResult[];
};

export type InterviewStatus = 'pending' | 'live' | 'completed' | 'abandoned';

export type InterviewSession = {
  id: string;
  applicationId: string;
  status: InterviewStatus;
  targetRole: string;
  agenda: AgendaItem[];
  startedAt: number;
  endedAt: number | null;
};

export type AgendaItem = {
  topic: string;
  focusArea: 'core_skill' | 'gap_probe' | 'project_deep_dive' | 'behavioral';
  estimatedMinutes: number;
};

export type Speaker = 'agent' | 'candidate';

export type InterviewTurn = {
  id: string;
  sessionId: string;
  turnIndex: number;
  speaker: Speaker;
  content: string;
  agentIntent: string | null;
  difficulty: number | null;
  audioMetrics: AudioMetrics | null;
  visualMetrics: VisualMetrics | null;
  ts: number;
};

/** Sent from browser per-turn — see lib/voice/audio-analyzer.ts */
export type AudioMetrics = {
  wpm: number;
  fillers_per_min: number;
  pause_ratio: number;        // 0..1
  pitch_mean_hz: number;
  pitch_variance: number;
  rms_mean: number;
  rms_variance: number;
  silence_pct: number;        // 0..1
};

/** Sent from browser per-turn — see lib/vision/metrics-aggregator.ts */
export type VisualMetrics = {
  eye_contact_ratio: number;        // 0..1
  head_pose_stability: number;      // 0..1, higher = more stable
  posture_score: number;            // 0..1
  smile_intensity_mean: number;     // 0..1
  brow_raise_mean: number;          // 0..1
  jaw_tension_mean: number;         // 0..1, higher = more tense
  blink_rate_per_min: number;
  frames_analyzed: number;
};

export type EvalDimension =
  | 'confidence'
  | 'clarity'
  | 'engagement'
  | 'stress'
  | 'eye_contact'
  | 'posture'
  | 'correctness'
  | 'depth'
  | 'specificity'
  | 'concept_coverage';

export type AgentEvaluation = {
  id: string;
  sessionId: string;
  turnId: string | null;
  agentKey: 'audio' | 'visual' | 'technical';
  dimension: EvalDimension;
  score: number; // 0..1
  evidence: unknown;
};

export type ReportScores = {
  technical: number;       // 0..100
  communication: number;   // 0..100
  confidence: number;      // 0..100
  engagement: number;      // 0..100
  overall: number;         // 0..100
};

export type Report = {
  id: string;
  sessionId: string;
  summaryMd: string;
  scores: ReportScores;
  strengthsMd: string;
  improvementsMd: string;
  behavioralInsightsMd: string;
  nextStepsMd: string;
  generatedAt: number;
};
