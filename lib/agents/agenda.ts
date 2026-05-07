/**
 * Agenda planner — produces a 5-7 item interview agenda from the
 * ContextProfile + the target Job. Runs once when the interview starts.
 *
 * Heuristic (no LLM call needed — fast and deterministic):
 *   - Up to 3 "core_skill" items, one per top must-have of the job
 *   - 2 "project_deep_dive" items from the candidate's top projects
 *   - 1 "behavioral" item (always)
 *   - 1 "gap_probe" if the candidate has obvious must-have gaps
 *
 * This gives the orchestrator a clear roadmap and keeps the interview from
 * meandering. The orchestrator can still adapt within these slots.
 */
import type {
  AgendaItem,
  ContextProfile,
  Job,
} from '@/lib/storage/types';

export function buildAgenda(profile: ContextProfile, job: Job): AgendaItem[] {
  const items: AgendaItem[] = [];

  // 1. Core skills to validate (top 3 must-haves)
  for (const must of job.jdStruct.must_haves.slice(0, 3)) {
    items.push({
      topic: `Validate: ${must}`,
      focusArea: 'core_skill',
      estimatedMinutes: 2,
    });
  }

  // 2. Project deep dives (top 2 projects with substance)
  const projects = profile.projects
    .filter((p) => p.summary.length > 20)
    .slice(0, 2);
  for (const p of projects) {
    items.push({
      topic: `Deep dive: ${p.name}`,
      focusArea: 'project_deep_dive',
      estimatedMinutes: 2,
    });
  }

  // 3. Always one behavioral
  items.push({
    topic: 'Leadership / collaboration scenario',
    focusArea: 'behavioral',
    estimatedMinutes: 2,
  });

  // 4. Optional gap probe — if obvious gap exists, probe it
  const gapCandidates = job.jdStruct.must_haves.filter((must) => {
    const text = (
      profile.skills.join(' ') +
      ' ' +
      profile.domains.join(' ') +
      ' ' +
      profile.roles.map((r) => r.title).join(' ')
    ).toLowerCase();
    const firstWord = must.split(' ')[0].toLowerCase();
    return firstWord.length >= 3 && !text.includes(firstWord);
  });
  if (gapCandidates.length > 0) {
    items.push({
      topic: `Probe gap: ${gapCandidates[0]}`,
      focusArea: 'gap_probe',
      estimatedMinutes: 2,
    });
  }

  return items;
}
