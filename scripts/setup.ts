/**
 * `npm run setup` — one-command project initialization.
 *
 * What it does:
 *   1. Loads .env.local (or warns if missing)
 *   2. Creates ./data/ directory if needed (local-dev SQLite + uploads)
 *   3. Applies db/schema.sql to the configured database
 *   4. Seeds db/seed/jobs.json into the jobs table
 *
 * Idempotent — safe to re-run anytime.
 */
import { config } from 'dotenv';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ulid } from 'ulid';

const root = process.cwd();
const envFile = resolve(root, '.env.local');
if (existsSync(envFile)) {
  config({ path: envFile });
} else {
  console.log('  .env.local not found — using process.env only');
}

async function main() {
  // 1. Ensure local data dir exists (used when TURSO_DATABASE_URL=file:...)
  const dataDir = resolve(root, 'data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
    console.log(`  created ${dataDir}`);
  }
  const uploadsDir = resolve(dataDir, 'uploads');
  if (!existsSync(uploadsDir)) {
    mkdirSync(uploadsDir, { recursive: true });
  }

  // Default to local SQLite if user hasn't configured Turso yet
  if (!process.env.TURSO_DATABASE_URL) {
    process.env.TURSO_DATABASE_URL = `file:${resolve(dataDir, 'iphipi.db')}`;
    console.log(`  using local SQLite at ${process.env.TURSO_DATABASE_URL}`);
  }

  // 2. Apply schema
  const { migrate, listJobs, upsertJob, newId } = await import('@/lib/storage/db');
  const schemaPath = resolve(root, 'db', 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf8');
  console.log('  running migrations...');
  await migrate(schema);
  console.log('  schema applied');

  // 3. Seed jobs
  const jobsPath = resolve(root, 'db', 'seed', 'jobs.json');
  const jobs = JSON.parse(readFileSync(jobsPath, 'utf8'));

  // Decide if we need to seed (skip if same number of rows exists)
  const existing = await listJobs();
  if (existing.length >= jobs.length) {
    console.log(`  jobs already seeded (${existing.length} rows) — skipping`);
  } else {
    for (const j of jobs) {
      await upsertJob({
        id: newId(),
        slug: j.slug,
        title: j.title,
        department: j.department,
        level: j.level,
        location: j.location,
        jdMd: j.jdMd,
        jdStruct: j.jdStruct,
        weights: j.weights,
      });
    }
    console.log(`  seeded ${jobs.length} jobs`);
  }

  console.log('\n  setup complete\n');
  console.log('  next: npm run dev');
}

main().catch((err) => {
  console.error('  setup failed:', err);
  process.exit(1);
});
