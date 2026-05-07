/**
 * /interview/[sessionId] — server-side shell for the live interview.
 *
 * Loads the session + opening turn from the DB (already created by
 * /api/interview/start), verifies cookie ownership, then renders the
 * client workspace which handles all multimodal capture + per-turn flow.
 */
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import {
  CANDIDATE_COOKIE_NAME,
  verifyCandidateToken,
} from '@/lib/auth/candidate-token';
import {
  getApplication,
  getInterviewSession,
  listTurns,
} from '@/lib/storage/db';
import { InterviewWorkspace } from '@/components/iphipi/interview-workspace';

export const dynamic = 'force-dynamic';

type Params = Promise<{ sessionId: string }>;

export default async function InterviewPage({ params }: { params: Params }) {
  const { sessionId } = await params;

  const cookieStore = await cookies();
  const candidateId = verifyCandidateToken(
    cookieStore.get(CANDIDATE_COOKIE_NAME)?.value
  );
  if (!candidateId) notFound();

  const session = await getInterviewSession(sessionId);
  if (!session) notFound();

  const application = await getApplication(session.applicationId);
  if (!application || application.candidateId !== candidateId) notFound();

  const turns = await listTurns(sessionId);

  return (
    <InterviewWorkspace
      sessionId={session.id}
      targetRole={session.targetRole}
      agenda={session.agenda}
      initialTurns={turns.map((t) => ({
        id: t.id,
        speaker: t.speaker,
        content: t.content,
        intent: t.agentIntent,
        difficulty: t.difficulty,
      }))}
      sessionStatus={session.status}
    />
  );
}
