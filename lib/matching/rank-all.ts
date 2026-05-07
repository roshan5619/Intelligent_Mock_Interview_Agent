/**
 * Rank a candidate's ContextProfile against EVERY IPHIPI job in the database.
 * Powers the /match-me page.
 *
 * Optimization: we score in parallel (Promise.all). On the free tier we may
 * occasionally hit Groq's 30 RPM cap when there are many jobs — the LLM
 * router auto-falls-back to Gemini if that happens.
 */
import { listJobs } from '@/lib/storage/db';
import { scoreMatch } from './jd-match';
import type { ContextProfile, RoleMatchResult } from '@/lib/storage/types';

export async function rankAllJobs(
  profile: ContextProfile
): Promise<RoleMatchResult[]> {
  const jobs = await listJobs();

  // Score in parallel — each scoreMatch call makes 1 embed + 1 generate request.
  const results = await Promise.all(
    jobs.map(async (job): Promise<RoleMatchResult> => {
      const breakdown = await scoreMatch(profile, job);
      return {
        jobId: job.id,
        jobSlug: job.slug,
        jobTitle: job.title,
        department: job.department,
        level: job.level,
        score: breakdown.score,
        breakdown,
        whyFitsMd: breakdown.rationale,
      };
    })
  );

  results.sort((a, b) => b.score - a.score);
  return results;
}
