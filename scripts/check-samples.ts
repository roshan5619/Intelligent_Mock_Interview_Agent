/**
 * `npm run check:samples` — regression test that the agent pipeline
 * produces structurally-valid outputs against the sample resume.
 *
 * What it does:
 *   1. Loads samples/resumes/senior-backend.txt
 *   2. Runs Agent 1 (parseResumeText)
 *   3. Asserts the ContextProfile has at least the expected sections
 *   4. Loads the staff-backend job
 *   5. Runs scoreMatch and asserts a sane breakdown
 *
 * NOT exact-match — LLM outputs vary. We check structural validity and
 * reasonable ranges (score ≥ 50 for this strong-fit sample).
 */
import { config } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(process.cwd(), '.env.local');
if (existsSync(envFile)) config({ path: envFile });

async function main() {
  const { parseResumeText } = await import('@/lib/agents/context-understanding');
  const { scoreMatch } = await import('@/lib/matching/jd-match');
  const { listJobs } = await import('@/lib/storage/db');

  console.log('\nIPHIPI sample-pipeline check\n');

  const resumePath = resolve(process.cwd(), 'samples', 'resumes', 'senior-backend.txt');
  const text = readFileSync(resumePath, 'utf8');

  console.log('  Step 1: parseResumeText (Agent 1)...');
  const profile = await parseResumeText(text);
  assert(profile.skills.length >= 5, 'expected ≥5 skills');
  assert(profile.years_total >= 10, 'expected years_total ≥ 10');
  assert(profile.roles.length >= 2, 'expected ≥2 roles');
  assert(profile.inferred_roles.length >= 1, 'expected ≥1 inferred_role');
  console.log(`         OK (${profile.skills.length} skills, ${profile.years_total}y, ${profile.inferred_roles.length} inferred roles)`);

  console.log('  Step 2: scoreMatch against staff-backend job...');
  const jobs = await listJobs();
  const target = jobs.find((j) => j.slug === 'staff-backend');
  assert(target !== undefined, 'staff-backend job not seeded — run npm run setup first');
  const breakdown = await scoreMatch(profile, target!);
  assert(breakdown.score >= 50, `expected match_score ≥ 50, got ${breakdown.score}`);
  assert(breakdown.matched.length >= 3, `expected ≥3 matched skills, got ${breakdown.matched.length}`);
  assert(breakdown.rationale.length >= 30, 'expected non-trivial rationale');
  console.log(`         OK (score=${breakdown.score}, matched=${breakdown.matched.length})`);

  console.log('\n  All sample checks passed.\n');
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`  FAILED: ${msg}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('  check:samples failed:', err);
  process.exit(1);
});
