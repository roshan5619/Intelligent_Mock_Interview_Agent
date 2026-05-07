/**
 * JD Match scoring — score a candidate's ContextProfile against one Job.
 *
 * Hybrid scoring:
 *   total =  0.4 * embedding_similarity     (semantic fit)
 *          + 0.4 * weighted_skill_overlap   (must-haves matter most)
 *          + 0.2 * seniority_fit            (years of experience match)
 *
 * Plus an LLM-generated rationale ("why this fits") that's grounded in the
 * deterministic numbers so it can't hallucinate a score.
 */
import * as llm from '@/lib/llm/client';
import { cosineSim } from '@/lib/embeddings/similarity';
import { AGENT_CONFIG } from '@/lib/llm/config';
import type {
  ContextProfile,
  Job,
  MatchBreakdown,
} from '@/lib/storage/types';

/** Score one (profile, job) pair. */
export async function scoreMatch(
  profile: ContextProfile,
  job: Job
): Promise<MatchBreakdown> {
  // 1. Compute deterministic sub-scores
  const embeddingSim = await embeddingSimilarity(profile, job);
  const { skillOverlap, matched, gaps } = weightedSkillOverlap(profile, job);
  const seniorityFit = seniorityScore(profile.years_total, job);

  // 2. Combine
  const score01 =
    0.4 * embeddingSim + 0.4 * skillOverlap + 0.2 * seniorityFit;
  const score = Math.round(clamp(score01, 0, 1) * 100);

  // 3. Generate the rationale grounded in the numbers above
  const rationale = await generateRationale({
    profile,
    job,
    score,
    matched,
    gaps,
  });

  return {
    score,
    embedding_similarity: round2(embeddingSim),
    skill_overlap: round2(skillOverlap),
    seniority_fit: round2(seniorityFit),
    matched,
    gaps,
    rationale,
  };
}

/* --------------------------------------------------- embedding similarity */

async function embeddingSimilarity(
  profile: ContextProfile,
  job: Job
): Promise<number> {
  const profileText = profileToText(profile);
  const jdText = jdToText(job);
  try {
    const { vectors } = await llm.embed([profileText, jdText]);
    return clamp(cosineSim(vectors[0], vectors[1]), 0, 1);
  } catch (err) {
    console.warn('[jd-match] embeddings unavailable, falling back to 0.5:', err);
    return 0.5; // neutral fallback so the rest of the score still works
  }
}

function profileToText(p: ContextProfile): string {
  return [
    'Skills: ' + p.skills.join(', '),
    'Domains: ' + p.domains.join(', '),
    'Roles: ' + p.roles.map((r) => r.title).join('; '),
    'Projects: ' + p.projects.map((pr) => `${pr.name} — ${pr.summary}`).join(' | '),
    'Seniority signals: ' + p.seniority_signals.join('; '),
  ].join('\n');
}

function jdToText(j: Job): string {
  return [
    'Title: ' + j.title,
    'Department: ' + j.department,
    'Level: ' + j.level,
    'Responsibilities: ' + j.jdStruct.responsibilities.join('; '),
    'Must-haves: ' + j.jdStruct.must_haves.join('; '),
    'Nice-to-haves: ' + j.jdStruct.nice_to_haves.join('; '),
  ].join('\n');
}

/* --------------------------------------------------- weighted skill overlap */

function weightedSkillOverlap(
  profile: ContextProfile,
  job: Job
): { skillOverlap: number; matched: string[]; gaps: string[] } {
  const profileTokens = tokenize([
    ...profile.skills,
    ...profile.domains,
    ...profile.roles.map((r) => r.title),
    ...profile.projects.flatMap((p) => p.tech ?? []),
    ...profile.seniority_signals,
  ].join(' '));

  const matched: string[] = [];
  const gaps: string[] = [];

  let earned = 0;
  let possible = 0;

  for (const must of job.jdStruct.must_haves) {
    possible += job.weights.must_have_weight;
    if (mentions(profileTokens, must)) {
      earned += job.weights.must_have_weight;
      matched.push(must);
    } else {
      gaps.push(must);
    }
  }
  for (const nice of job.jdStruct.nice_to_haves) {
    possible += job.weights.nice_to_have_weight;
    if (mentions(profileTokens, nice)) {
      earned += job.weights.nice_to_have_weight;
      matched.push(nice);
    }
    // niceties don't go into the gaps list (they're not blockers)
  }

  return {
    skillOverlap: possible === 0 ? 0 : earned / possible,
    matched,
    gaps,
  };
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9+#./\s-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
  );
}

/**
 * `mentions` returns true if any "keyword" of the requirement is present in
 * the profile token bag. We split on whitespace and "or" so a JD like
 * "Java or Kotlin or Go or Rust" matches a candidate who knows just Go.
 */
function mentions(tokens: Set<string>, req: string): boolean {
  const phrases = req
    .toLowerCase()
    .split(/\bor\b/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const phrase of phrases) {
    const words = phrase
      .replace(/[^a-z0-9+#./\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2);
    if (words.length === 0) continue;
    // Loose match: a phrase counts if any of its content words is in the bag
    // (skipping common stopwords).
    const STOP = new Set([
      'and', 'the', 'for', 'with', 'years', 'year', 'experience', 'in', 'a', 'an',
      'on', 'of', 'or', 'to',
    ]);
    const content = words.filter((w) => !STOP.has(w));
    if (content.some((w) => tokens.has(w))) return true;
  }
  return false;
}

/* --------------------------------------------------- seniority */

function seniorityScore(yearsTotal: number, job: Job): number {
  const { min, max } = job.jdStruct.ideal_years_experience;
  if (yearsTotal >= min && yearsTotal <= max) return 1;
  if (yearsTotal >= min - 2 && yearsTotal <= max + 4) return 0.7;
  if (yearsTotal >= min - 4) return 0.4;
  return 0.1;
}

/* --------------------------------------------------- rationale (LLM) */

async function generateRationale(input: {
  profile: ContextProfile;
  job: Job;
  score: number;
  matched: string[];
  gaps: string[];
}): Promise<string> {
  const cfg = AGENT_CONFIG['jd-match-rationale'];
  const result = await llm.generate({
    preferProvider: cfg.preferProvider,
    options: { ...cfg.options, max_tokens: 250 },
    messages: [
      {
        role: 'system',
        content:
          'You are an expert technical recruiter. Given a candidate profile, a job, and the deterministic numeric match score, write a SHORT (2-3 sentences) "why this fits" explanation. Be specific. Cite real evidence from the profile. Never invent skills the candidate does not claim. Plain text only — no markdown, no bullet points.',
      },
      {
        role: 'user',
        content: rationalePromptUser(input),
      },
    ],
  });
  return result.text.trim();
}

function rationalePromptUser(input: {
  profile: ContextProfile;
  job: Job;
  score: number;
  matched: string[];
  gaps: string[];
}): string {
  return [
    `Job: ${input.job.title} (${input.job.level}, ${input.job.department})`,
    `Match score: ${input.score}/100`,
    `Candidate matched these requirements: ${input.matched.slice(0, 6).join(', ') || 'none'}`,
    `Candidate gaps on must-haves: ${input.gaps.slice(0, 4).join(', ') || 'none'}`,
    `Candidate years_total: ${input.profile.years_total}`,
    `Candidate top skills: ${input.profile.skills.slice(0, 8).join(', ')}`,
    `Candidate top projects: ${input.profile.projects.slice(0, 3).map((p) => p.name).join('; ')}`,
    '',
    'Write the 2-3 sentence "why this fits" explanation now.',
  ].join('\n');
}

/* --------------------------------------------------- math helpers */

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
