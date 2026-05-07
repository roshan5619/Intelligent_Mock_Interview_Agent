# Sample report — `staff-backend` interview, senior-backend.txt resume

> **EXAMPLE OUTPUT.** Actual values vary per LLM run. Use this as a reference for the *shape* of the report, not exact wording.

---

**Headline:** Strong technical foundations and crisp narrative throughout the system-design probe. Communication ran ahead of vocal confidence — there are clear, fixable wins on pacing and structure.

## Scores

| Dimension | Score |
|---|---|
| Technical | 82 |
| Communication | 79 |
| Confidence | 71 |
| Engagement | 84 |
| **Overall** | **80** |

## Strengths

- **Concrete tradeoffs.** When asked about the Kafka + Postgres choice, you explicitly named the *constraint* (zero-downtime cutover) and the *cost* (eventual consistency for 24h). Quote: "the dual-write reconciliation was the lever — without it the cutover would have taken months."
- **Owns outcomes.** Every project answer led with a number. Quote: "p99 went from 380ms to 78ms — and on-call paging dropped 70%."
- **Senior framing.** Took the leadership question and reframed it from "I did" to "I created the conditions for the team to" — a hallmark of staff-level thinking.

## Where to improve

- **Vocal pacing during system-design.** WPM averaged 168 on the sharding question (target: 110-160). When you sped up, your pitch flattened — listeners parse this as uncertainty even when the content is strong. **Practice: read aloud the answer to one design question per day, recording yourself, and aim for ≤155 WPM.**
- **Structure on behavioral answers.** The mentorship answer was a list of facts, not a story. Use the formula: *situation → tension → choice → outcome*. **Practice: rewrite three of your actual mentorship moments as 90-second stories with that exact structure.**
- **Open with the constraint, not the technology.** Twice you led with "we chose Kafka because…" — interviewers want "the constraint was X, so we chose Kafka because Y." **Practice: prefix every answer this week with "the constraint was…".**

## Behavioral insights

Vocal confidence dropped 18% during the database-sharding question; pitch flattened (variance 12 → 4) and pause ratio doubled. This often signals you're *fact-checking yourself live* rather than letting the answer land — which paradoxically reads as less confident even though the answer was correct. The visual signals corroborate: jaw tension up 30%, eye contact off-axis (looking up-left = retrieval mode). Try restating the question aloud before answering — it both buys thinking time AND resets the vocal frame.

Engagement was consistently high (84) — your facial expression activation (smile, brow raise, head nods) read as genuinely curious, not performative.

## Next steps this week

- **Daily, 10 min:** Record yourself answering one of the questions you missed, aim for ≤155 WPM, listen back the next morning.
- **One mock interview:** With a peer, focus on opening every answer with the constraint.
- **Read:** *Designing Data-Intensive Applications* Ch. 9 (Consistency and Consensus) — the only must-have you didn't cover well was the consensus deep-dive.
- **Build:** A toy CRDT-based counter to internalize eventual consistency tradeoffs — you'll be able to cite this in the next interview.
- **Pre-interview ritual:** 60 seconds of slow box breathing immediately before the call. Your confidence numbers were highest in turns 1-2 and dipped from turn 3 — typical adrenaline drop pattern.
