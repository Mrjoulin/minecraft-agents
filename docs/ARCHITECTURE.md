# System architecture

## 1. Big picture

```
                 ┌────────────────────────── Game Master / Orchestrator ──────────────────────────┐
                 │ scenario.yaml → world reset, spawns bots, rolls hidden traits & motives,        │
                 │ time limit, ground-truth log, final scoring                                      │
                 └───────────────┬─────────────────────────────────────────────┬──────────────────┘
                                 │                                             │
        ┌────────────────────────▼───────────┐                ┌────────────────▼─────────────────┐
        │        COMMANDER (1 bot)           │                │     SUB-AGENTS (3–5 bots)        │
        │  Goal → Task DAG planner           │   proximity    │  Persona (traits, secret motive) │
        │  Assignment & route planner        │◄──speech──────►│  Memory (episodic + beliefs)     │
        │  Observation → Evidence extractor  │   (≤ R blocks) │  Deliberation (LLM)              │
        │  Theory-of-Mind belief model       │                │  Non-disclosure guard            │
        │  Incentive engine (reward/punish)  │                │  Skill executor                  │
        └───────────────┬────────────────────┘                └───────────────┬──────────────────┘
                        │                    ┌──────────────┐                 │
                        └──────────────────► │ Skill layer  │ ◄───────────────┘
                                             │ (Mineflayer) │
                                             └──────┬───────┘
                                                    │ Minecraft protocol
                                        ┌───────────▼────────────┐
                                        │ Minecraft server 1.21.x│
                                        └────────────────────────┘
   Cross-cutting: LLM gateway (OpenAI-compatible, per-agent model & budget) · Telemetry (JSONL) ·
                  Spectator dashboard (3D viewer + speech + commander beliefs) · Evaluation suite
```

## 2. Components

### 2.1 Environment
* Minecraft Java server (vanilla/Paper 1.21.4), offline mode, fixed seed per experiment.
* **Game Master** (orchestrator process): spawns bots, assigns personas from a pool, resets world
  between runs (backup copy of `world/`), enforces time limit, writes the ground truth
  (who had which trait/motive) that the commander must *not* read.

### 2.2 Skill layer ("body") — reused
Mineflayer + plugins. High-level, deterministic, testable actions with results reported as text:
`goTo(pos|player)`, `collect(block, n)`, `craft(item, n)`, `place/build(blueprint)`, `follow(player)`,
`give(player, item, n)`, `deposit/withdraw(chest)`, `attack(entity)`, `equipBest()`, `sleep()`.
Source: Mindcraft `skills.js` (MIT) + our additions. Each skill emits **events** (started/progress/done/failed).

### 2.3 Proximity communication bus (new)
* Every utterance is `{speaker, pos, text, volume: whisper|talk|shout}`; hearing radius 4/16/48 blocks.
* Router delivers it only to agents within radius (optionally line-of-sight) → **overhearing** is natural.
* Mirrored to the game with `/tellraw` to nearby players so spectators see speech bubbles in chat.
* Commander orders are only valid when the commander is within *talk* radius of the addressee
  (enforced by the router, not by the prompt).

### 2.4 Sub-agent mind
| Module | Responsibility |
|---|---|
| Persona | Public name + hidden **traits** (e.g. nyctophobic, animal-lover, lazy, perfectionist, chatterbox, coward) and **secret motive** (best armor, most diamonds, eliminate others, become commander…) |
| Behaviour hooks | Code-level modifiers that make traits *observable* even when the LLM is silent (fear of dark → refuses tasks when light level < 7 or at night; animal-lover → detours to animals, refuses to kill) |
| Memory | Short-term buffer + episodic log + beliefs about others (what it heard / saw) |
| Deliberation (LLM) | Decides what to say and which skill to run next, balancing *orders* vs *traits* vs *secret motive* vs *expected reward/punishment* |
| Non-disclosure guard | Post-filter on outgoing speech (keyword + LLM-judge) blocks literal disclosure of secrets; counts attempted leaks |

### 2.5 Commander mind
| Module | Responsibility |
|---|---|
| Goal planner | Ultimate goal → task DAG (VillagerAgent-style), re-planned on failure |
| Assignment | Matches tasks to agents using *estimated* skill/trait profiles + reliability |
| Navigator | Since orders are in-person, plans a route to visit agents (TSP-ish), decides when to watch vs. walk |
| Evidence extractor | Turns what the commander can **see** (entities in view radius, held items, inventory deltas on hand-over, position history) into text observations: "Bram stopped at the cave mouth at night" |
| Theory-of-Mind model | Per-agent hypothesis table `trait → confidence`, updated by the LLM from evidence; final guess is scored vs ground truth |
| Incentive engine | Rewards & punishments (see 2.6) |

### 2.6 Reward / punishment mechanics (proposal)
* **Currency:** emeralds paid by the commander from a treasury chest ("salary" per delivered item).
* **Rewards:** better tools/armour from the armoury, choice of next task, public praise (reputation +).
* **Punishments:** fine (take emeralds/items), "jail" (teleport to a fenced area for N minutes, via
  Game Master), reassign to boring tasks, public reprimand (reputation −).
* Agents' prompts contain a utility: `orders fulfilled + reward − punishment + motive progress`, so
  incentives really change behaviour (an armour-seeker values armour rewards, a diamond hoarder
  is tempted to hide diamonds → detectable by inventory audit).

### 2.7 LLM gateway
OpenAI-compatible client, per-agent model choice, retries/timeouts, token & cost accounting, JSON-mode
responses validated by schema, request cache for reproducible tests.

### 2.8 Telemetry, dashboard, evaluation
* JSONL event log (speech, skill events, LLM calls, belief updates) → replay and plots.
* Web dashboard: Prismarine 3D viewer + speech feed + commander belief table + scoreboard.
* **Metrics:** goal completion & time; **trait-identification accuracy** (commander's final guess vs
  truth); secret-leak rate; sabotage incidents detected; reward fairness; tokens/cost per goal.
* Baselines: random assignment, commander *with* oracle trait knowledge, commander without ToM module.

## 3. Information boundaries (important for honesty of the experiment)
| Who | Knows |
|---|---|
| Game Master | everything (ground truth) |
| Commander | the goal, its own observations within view radius, what it hears; **not** traits/motives |
| Sub-agent | own persona & motive, own observations, what it hears within radius |

## 4. Repository layout (target)
```
src/
  llm.js           LLM gateway
  speech.js        proximity bus
  personas.js      trait & motive catalogue
  skills/          body actions (Mineflayer)
  agents/worker.js sub-agent mind
  agents/commander.js
  gm/              game master, scenarios, world reset
  dashboard/       spectator UI
test/              unit tests (router, guard, belief updates) + scenario tests
docs/
```
