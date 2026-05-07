/**
 * Database access layer (libSQL / SQLite-compatible).
 *
 * One typed function per query — easy to unit test, easy to swap to Postgres
 * (the SQL is portable). Each query handles the JSON column shape so callers
 * always get plain TS objects.
 *
 * Connection modes:
 *   - Production: TURSO_DATABASE_URL + TURSO_AUTH_TOKEN (managed Turso libSQL)
 *   - Local dev:  TURSO_DATABASE_URL=file:./data/iphipi.db (no auth token)
 */
import { createClient, type Client } from '@libsql/client';
import { ulid } from 'ulid';
import type {
  AgendaItem,
  AgentEvaluation,
  Application,
  ApplicationStatus,
  AudioMetrics,
  Candidate,
  ContextProfile,
  EvalDimension,
  InterviewSession,
  InterviewStatus,
  InterviewTurn,
  Job,
  MatchBreakdown,
  Report,
  RoleMatchResult,
  RoleMatchRun,
  Speaker,
  VisualMetrics,
} from './types';

let client: Client | null = null;
function db(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) {
      throw new Error(
        'TURSO_DATABASE_URL is not set. For local dev, use file:./data/iphipi.db'
      );
    }
    client = createClient({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

/** Run schema migration. Idempotent (CREATE TABLE IF NOT EXISTS). */
export async function migrate(schemaSql: string): Promise<void> {
  // libSQL accepts multi-statement scripts via execute({ sql }) for batch.
  const stmts = schemaSql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sql of stmts) {
    await db().execute(sql);
  }
}

export function newId(): string {
  return ulid();
}

/* ----------------------------------------------------------- candidates  */

export async function createCandidate(input: {
  email?: string | null;
  name?: string | null;
}): Promise<Candidate> {
  const c: Candidate = {
    id: newId(),
    email: input.email ?? null,
    name: input.name ?? null,
    createdAt: nowSec(),
  };
  await db().execute({
    sql: 'INSERT INTO candidates (id, email, name, created_at) VALUES (?, ?, ?, ?)',
    args: [c.id, c.email, c.name, c.createdAt],
  });
  return c;
}

export async function getCandidate(id: string): Promise<Candidate | null> {
  const r = await db().execute({
    sql: 'SELECT * FROM candidates WHERE id = ?',
    args: [id],
  });
  if (!r.rows[0]) return null;
  const row = r.rows[0] as Record<string, unknown>;
  return {
    id: String(row.id),
    email: row.email as string | null,
    name: row.name as string | null,
    createdAt: Number(row.created_at),
  };
}

/* ----------------------------------------------------------- jobs  */

export async function listJobs(): Promise<Job[]> {
  const r = await db().execute('SELECT * FROM jobs ORDER BY title');
  return r.rows.map(jobFromRow);
}

export async function getJob(id: string): Promise<Job | null> {
  const r = await db().execute({
    sql: 'SELECT * FROM jobs WHERE id = ?',
    args: [id],
  });
  return r.rows[0] ? jobFromRow(r.rows[0]) : null;
}

export async function getJobBySlug(slug: string): Promise<Job | null> {
  const r = await db().execute({
    sql: 'SELECT * FROM jobs WHERE slug = ?',
    args: [slug],
  });
  return r.rows[0] ? jobFromRow(r.rows[0]) : null;
}

export async function upsertJob(j: Job): Promise<void> {
  await db().execute({
    sql: `INSERT INTO jobs (id, slug, title, department, level, location, jd_md, jd_struct_json, weights_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(slug) DO UPDATE SET
            title=excluded.title, department=excluded.department, level=excluded.level,
            location=excluded.location, jd_md=excluded.jd_md, jd_struct_json=excluded.jd_struct_json,
            weights_json=excluded.weights_json`,
    args: [
      j.id,
      j.slug,
      j.title,
      j.department,
      j.level,
      j.location,
      j.jdMd,
      JSON.stringify(j.jdStruct),
      JSON.stringify(j.weights),
    ],
  });
}

function jobFromRow(row: Record<string, unknown>): Job {
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    department: String(row.department),
    level: row.level as Job['level'],
    location: String(row.location),
    jdMd: String(row.jd_md),
    jdStruct: JSON.parse(String(row.jd_struct_json)),
    weights: JSON.parse(String(row.weights_json)),
  };
}

/* ----------------------------------------------------------- applications  */

export async function createApplication(input: {
  candidateId: string;
  jobId: string | null;
  resumeBlobUrl: string;
  resumeFilename: string;
}): Promise<Application> {
  const a: Application = {
    id: newId(),
    candidateId: input.candidateId,
    jobId: input.jobId,
    resumeBlobUrl: input.resumeBlobUrl,
    resumeFilename: input.resumeFilename,
    contextProfile: null,
    matchScore: null,
    matchBreakdown: null,
    status: 'parsing',
    createdAt: nowSec(),
  };
  await db().execute({
    sql: `INSERT INTO applications (id, candidate_id, job_id, resume_blob_url, resume_filename,
          context_profile_json, match_score, match_breakdown_json, status, created_at)
          VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
    args: [a.id, a.candidateId, a.jobId, a.resumeBlobUrl, a.resumeFilename, a.status, a.createdAt],
  });
  return a;
}

export async function getApplication(id: string): Promise<Application | null> {
  const r = await db().execute({
    sql: 'SELECT * FROM applications WHERE id = ?',
    args: [id],
  });
  return r.rows[0] ? applicationFromRow(r.rows[0]) : null;
}

export async function updateApplicationContext(
  id: string,
  contextProfile: ContextProfile
): Promise<void> {
  await db().execute({
    sql: 'UPDATE applications SET context_profile_json = ? WHERE id = ?',
    args: [JSON.stringify(contextProfile), id],
  });
}

export async function updateApplicationMatch(
  id: string,
  match: MatchBreakdown
): Promise<void> {
  await db().execute({
    sql: 'UPDATE applications SET match_score = ?, match_breakdown_json = ?, status = ? WHERE id = ?',
    args: [match.score, JSON.stringify(match), 'ready', id],
  });
}

export async function setApplicationStatus(
  id: string,
  status: ApplicationStatus
): Promise<void> {
  await db().execute({
    sql: 'UPDATE applications SET status = ? WHERE id = ?',
    args: [status, id],
  });
}

function applicationFromRow(row: Record<string, unknown>): Application {
  return {
    id: String(row.id),
    candidateId: String(row.candidate_id),
    jobId: row.job_id ? String(row.job_id) : null,
    resumeBlobUrl: String(row.resume_blob_url),
    resumeFilename: String(row.resume_filename),
    contextProfile: row.context_profile_json
      ? JSON.parse(String(row.context_profile_json))
      : null,
    matchScore: row.match_score === null || row.match_score === undefined
      ? null
      : Number(row.match_score),
    matchBreakdown: row.match_breakdown_json
      ? JSON.parse(String(row.match_breakdown_json))
      : null,
    status: row.status as ApplicationStatus,
    createdAt: Number(row.created_at),
  };
}

/* ----------------------------------------------------------- role match runs  */

export async function saveRoleMatchRun(input: {
  candidateId: string;
  results: RoleMatchResult[];
}): Promise<RoleMatchRun> {
  const run: RoleMatchRun = {
    id: newId(),
    candidateId: input.candidateId,
    scoredAt: nowSec(),
    results: input.results,
  };
  await db().execute({
    sql: 'INSERT INTO role_match_runs (id, candidate_id, scored_at, results_json) VALUES (?, ?, ?, ?)',
    args: [run.id, run.candidateId, run.scoredAt, JSON.stringify(run.results)],
  });
  return run;
}

export async function getLatestRoleMatchRun(
  candidateId: string
): Promise<RoleMatchRun | null> {
  const r = await db().execute({
    sql: 'SELECT * FROM role_match_runs WHERE candidate_id = ? ORDER BY scored_at DESC LIMIT 1',
    args: [candidateId],
  });
  if (!r.rows[0]) return null;
  const row = r.rows[0] as Record<string, unknown>;
  return {
    id: String(row.id),
    candidateId: String(row.candidate_id),
    scoredAt: Number(row.scored_at),
    results: JSON.parse(String(row.results_json)),
  };
}

/* ----------------------------------------------------------- interview sessions  */

export async function createInterviewSession(input: {
  applicationId: string;
  targetRole: string;
  agenda: AgendaItem[];
}): Promise<InterviewSession> {
  const s: InterviewSession = {
    id: newId(),
    applicationId: input.applicationId,
    status: 'pending',
    targetRole: input.targetRole,
    agenda: input.agenda,
    startedAt: nowSec(),
    endedAt: null,
  };
  await db().execute({
    sql: `INSERT INTO interview_sessions (id, application_id, status, target_role, agenda_json, started_at, ended_at)
          VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    args: [s.id, s.applicationId, s.status, s.targetRole, JSON.stringify(s.agenda), s.startedAt],
  });
  return s;
}

export async function getInterviewSession(
  id: string
): Promise<InterviewSession | null> {
  const r = await db().execute({
    sql: 'SELECT * FROM interview_sessions WHERE id = ?',
    args: [id],
  });
  if (!r.rows[0]) return null;
  const row = r.rows[0] as Record<string, unknown>;
  return {
    id: String(row.id),
    applicationId: String(row.application_id),
    status: row.status as InterviewStatus,
    targetRole: String(row.target_role),
    agenda: JSON.parse(String(row.agenda_json)),
    startedAt: Number(row.started_at),
    endedAt: row.ended_at === null || row.ended_at === undefined
      ? null
      : Number(row.ended_at),
  };
}

export async function setInterviewStatus(
  id: string,
  status: InterviewStatus
): Promise<void> {
  if (status === 'completed') {
    await db().execute({
      sql: 'UPDATE interview_sessions SET status = ?, ended_at = ? WHERE id = ?',
      args: [status, nowSec(), id],
    });
  } else {
    await db().execute({
      sql: 'UPDATE interview_sessions SET status = ? WHERE id = ?',
      args: [status, id],
    });
  }
}

/* ----------------------------------------------------------- turns  */

export async function appendTurn(input: {
  sessionId: string;
  turnIndex: number;
  speaker: Speaker;
  content: string;
  agentIntent?: string | null;
  difficulty?: number | null;
  audioMetrics?: AudioMetrics | null;
  visualMetrics?: VisualMetrics | null;
}): Promise<InterviewTurn> {
  const t: InterviewTurn = {
    id: newId(),
    sessionId: input.sessionId,
    turnIndex: input.turnIndex,
    speaker: input.speaker,
    content: input.content,
    agentIntent: input.agentIntent ?? null,
    difficulty: input.difficulty ?? null,
    audioMetrics: input.audioMetrics ?? null,
    visualMetrics: input.visualMetrics ?? null,
    ts: nowSec(),
  };
  await db().execute({
    sql: `INSERT INTO interview_turns (id, session_id, turn_index, speaker, content, agent_intent, difficulty, audio_metrics_json, visual_metrics_json, ts)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      t.id, t.sessionId, t.turnIndex, t.speaker, t.content,
      t.agentIntent, t.difficulty,
      t.audioMetrics ? JSON.stringify(t.audioMetrics) : null,
      t.visualMetrics ? JSON.stringify(t.visualMetrics) : null,
      t.ts,
    ],
  });
  return t;
}

export async function listTurns(sessionId: string): Promise<InterviewTurn[]> {
  const r = await db().execute({
    sql: 'SELECT * FROM interview_turns WHERE session_id = ? ORDER BY turn_index ASC',
    args: [sessionId],
  });
  return r.rows.map((row): InterviewTurn => {
    const r0 = row as Record<string, unknown>;
    return {
      id: String(r0.id),
      sessionId: String(r0.session_id),
      turnIndex: Number(r0.turn_index),
      speaker: r0.speaker as Speaker,
      content: String(r0.content),
      agentIntent: r0.agent_intent === null || r0.agent_intent === undefined
        ? null
        : String(r0.agent_intent),
      difficulty: r0.difficulty === null || r0.difficulty === undefined
        ? null
        : Number(r0.difficulty),
      audioMetrics: r0.audio_metrics_json
        ? JSON.parse(String(r0.audio_metrics_json))
        : null,
      visualMetrics: r0.visual_metrics_json
        ? JSON.parse(String(r0.visual_metrics_json))
        : null,
      ts: Number(r0.ts),
    };
  });
}

/* ----------------------------------------------------------- evaluations  */

export async function appendEvaluation(input: {
  sessionId: string;
  turnId: string | null;
  agentKey: AgentEvaluation['agentKey'];
  dimension: EvalDimension;
  score: number;
  evidence?: unknown;
}): Promise<AgentEvaluation> {
  const e: AgentEvaluation = {
    id: newId(),
    sessionId: input.sessionId,
    turnId: input.turnId,
    agentKey: input.agentKey,
    dimension: input.dimension,
    score: input.score,
    evidence: input.evidence ?? null,
  };
  await db().execute({
    sql: `INSERT INTO agent_evaluations (id, session_id, turn_id, agent_key, dimension, score, evidence_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [e.id, e.sessionId, e.turnId, e.agentKey, e.dimension, e.score, JSON.stringify(e.evidence)],
  });
  return e;
}

export async function listEvaluations(
  sessionId: string
): Promise<AgentEvaluation[]> {
  const r = await db().execute({
    sql: 'SELECT * FROM agent_evaluations WHERE session_id = ?',
    args: [sessionId],
  });
  return r.rows.map((row): AgentEvaluation => {
    const r0 = row as Record<string, unknown>;
    return {
      id: String(r0.id),
      sessionId: String(r0.session_id),
      turnId: r0.turn_id === null || r0.turn_id === undefined
        ? null
        : String(r0.turn_id),
      agentKey: r0.agent_key as AgentEvaluation['agentKey'],
      dimension: r0.dimension as EvalDimension,
      score: Number(r0.score),
      evidence: r0.evidence_json ? JSON.parse(String(r0.evidence_json)) : null,
    };
  });
}

/* ----------------------------------------------------------- reports  */

export async function saveReport(report: Omit<Report, 'id'>): Promise<Report> {
  const r: Report = { id: newId(), ...report };
  await db().execute({
    sql: `INSERT INTO reports (id, session_id, summary_md, scores_json, strengths_md, improvements_md, behavioral_insights_md, next_steps_md, generated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET
            summary_md=excluded.summary_md, scores_json=excluded.scores_json,
            strengths_md=excluded.strengths_md, improvements_md=excluded.improvements_md,
            behavioral_insights_md=excluded.behavioral_insights_md,
            next_steps_md=excluded.next_steps_md, generated_at=excluded.generated_at`,
    args: [
      r.id, r.sessionId, r.summaryMd, JSON.stringify(r.scores),
      r.strengthsMd, r.improvementsMd, r.behavioralInsightsMd,
      r.nextStepsMd, r.generatedAt,
    ],
  });
  return r;
}

export async function getReportBySession(
  sessionId: string
): Promise<Report | null> {
  const r = await db().execute({
    sql: 'SELECT * FROM reports WHERE session_id = ?',
    args: [sessionId],
  });
  if (!r.rows[0]) return null;
  const row = r.rows[0] as Record<string, unknown>;
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    summaryMd: String(row.summary_md),
    scores: JSON.parse(String(row.scores_json)),
    strengthsMd: String(row.strengths_md),
    improvementsMd: String(row.improvements_md),
    behavioralInsightsMd: String(row.behavioral_insights_md),
    nextStepsMd: String(row.next_steps_md),
    generatedAt: Number(row.generated_at),
  };
}

/* ----------------------------------------------------------- helpers  */

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
