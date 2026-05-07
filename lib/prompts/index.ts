/**
 * Versioned system prompts loaded from .md files at build time.
 * Keeping prompts as text files (not string literals) makes them:
 *   - easy to read and edit without TypeScript noise
 *   - diff-friendly in pull requests
 *   - portable to a future prompt-management UI
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROMPTS_DIR = resolve(process.cwd(), 'lib', 'prompts');

function load(file: string): string {
  return readFileSync(resolve(PROMPTS_DIR, file), 'utf8');
}

// Each prompt is loaded once and cached.
let _contextUnderstanding: string | null = null;
export function contextUnderstandingPrompt(): string {
  if (!_contextUnderstanding) {
    _contextUnderstanding = load('01_context_understanding.md');
  }
  return _contextUnderstanding;
}

let _orchestrator: string | null = null;
export function orchestratorPrompt(): string {
  if (!_orchestrator) _orchestrator = load('02_orchestrator.md');
  return _orchestrator;
}

let _technicalEvaluation: string | null = null;
export function technicalEvaluationPrompt(): string {
  if (!_technicalEvaluation) {
    _technicalEvaluation = load('05_technical_evaluation.md');
  }
  return _technicalEvaluation;
}

let _feedbackCoaching: string | null = null;
export function feedbackCoachingPrompt(): string {
  if (!_feedbackCoaching) {
    _feedbackCoaching = load('06_feedback_coaching.md');
  }
  return _feedbackCoaching;
}

let _audioScoring: string | null = null;
export function audioScoringPrompt(): string {
  if (!_audioScoring) _audioScoring = load('03_audio_intelligence.md');
  return _audioScoring;
}
