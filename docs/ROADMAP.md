# Execution plan — 5 stages × 2 weeks

Each stage ends with a progress report at the university class: a short live/recorded demo,
the metric(s) listed, and what moves to the next stage. Stages are sized to be roughly equal
(~1 demoable capability + 1 measurable result each).

Suggested split for a team of 4 (adapt to your size): **A** – environment & skills,
**B** – agent minds & prompts, **C** – commander & ToM, **D** – telemetry, dashboard, evaluation.

---

## Stage 1 (weeks 1–2) — Foundation: world, bodies, voices
**Goal:** one LLM-driven bot does real work on command; proximity speech works.
* Server (1.21.4, offline, fixed seed) + scripted world reset.
* Fork Mindcraft skill layer; wrap 8–10 skills (`goTo`, `collect`, `craft`, `give`, `follow`, `deposit`…).
* LLM gateway (OpenAI-compatible, DeepSeek flash) with JSON-schema actions.
* Proximity speech router (whisper/talk/shout radii) + unit tests.
* ADR: technology choice (see `RESEARCH.md`).

**Demo:** "Bot, bring me 10 oak logs" → bot does it; a second bot 30 blocks away does *not* hear it.
**Metrics:** skill success rate on 20 scripted tasks; router tests green.

## Stage 2 (weeks 3–4) — Sub-agents with personalities and secrets
**Goal:** 3–5 agents act in parallel with visibly different behaviour.
* Persona catalogue: ≥6 traits, ≥4 secret motives, random roll by the Game Master.
* Behaviour hooks so traits are observable (darkness check, animal detours, laziness = slower/smaller deliveries…).
* Agent memory (short-term + episodic) and agent-to-agent conversation via the router.
* Non-disclosure guard + "interrogation" test suite (prompt the agent to reveal its secret 50 ways).

**Demo:** same task given to 4 agents → 4 different behaviours.
**Metrics:** secret-leak rate under interrogation (target < 5 %); trait-behaviour consistency (human-rated).

## Stage 3 (weeks 5–6) — Commander: plan, walk, order
**Goal:** commander completes a medium goal with naive assumptions about agents.
* Goal → task DAG planner (e.g. "wooden house", "iron tools for everyone").
* In-person ordering: navigation to agents, order protocol, acknowledgement, progress check-ins.
* Status tracking from deliveries/inventory hand-overs; re-planning on failure.
* Spectator dashboard v1 (3D viewer + speech feed).

**Demo:** commander builds a small house with 3 agents, walking between them.
**Metrics:** goal completion rate & time over 5 runs; # orders issued; LLM cost per goal.

## Stage 4 (weeks 7–8) — Observation, deduction, incentives
**Goal:** commander discovers hidden traits and uses rewards/punishments.
* Evidence extractor (what the commander can see/hear) + Theory-of-Mind belief table.
* Adaptive assignment (don't send the nyctophobe into a cave; give animal-lover the farm).
* Reward/punishment economy (emerald salary, armoury, fines, jail via Game Master).
* Secret-motive pressure: hoarding, armour race, sabotage ("eliminate others") with detection.

**Demo:** commander says "Bram fears the dark — Bram, take the surface job" and fines a hoarder.
**Metrics:** trait-identification accuracy vs ground truth; completion time *with* vs *without* ToM.

## Stage 5 (weeks 9–10) — Evaluation, polish, final demo
**Goal:** scientific result + showcase.
* Experiment batch: ≥20 sessions across goals/persona mixes; baselines (random assignment, oracle, no-ToM).
* Ablations: hearing radius, number of agents, model size (flash vs pro for commander).
* Dashboard v2 with replay from JSONL logs; final video; written report.
* Stretch: unionclef client body for the commander; "all achievements" long-horizon goal.

**Demo:** final video + live run. **Metrics:** full results table, plots.

---

## Risks & mitigations
| Risk | Mitigation |
|---|---|
| Mineflayer skill flakiness (pathing, crafting) | Reuse Mindcraft skills; deterministic skills + LLM only chooses; retries; scenario tests |
| LLM latency/cost with 5 agents | Cheap flash model for workers; event-driven calls (not per tick); response cache |
| Agents leak secrets | Code-level guard + leak metric, not only prompt instructions |
| Traits invisible to observer | Behaviour hooks in code make traits observable; validate in Stage 2 |
| Non-reproducible runs | Fixed seeds, world reset, logged LLM I/O, temperature 0 for eval runs |
