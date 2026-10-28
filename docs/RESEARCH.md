# Prior art & technology choice

Survey done 2026-10-27. Goal: reuse as much as possible and build only what is new in our
idea (hidden personalities, in-person/proximity communication, commander theory-of-mind,
reward/punishment).

## Candidate foundations

| Project | What it is | Stack | License | Fit for us |
|---|---|---|---|---|
| [unionclef](https://github.com/3ndetz/unionclef) | altoclef + baritone + tungsten merged into a **Fabric client mod**; exposes ~60 tools over an HTTP **MCP server** and a Py4J bridge | Java 21, Fabric, MC 1.21.x | GPL-3.0 | Very strong "body" (A* physics pathfinding, PvP, full survival playthrough up to Nether), but **one full game client per agent** (~1.5–3 GB RAM each, needs GPU/window). No multi-agent coordination. Good for a *single* high-skill agent or as a stretch goal. |
| [Mindcraft](https://github.com/mindcraft-bots/mindcraft) (+ [MineCollab paper](https://arxiv.org/abs/2504.17950)) | LLM agents on **Mineflayer**; JSON "profiles" per bot, many LLM providers, `!commands` skill layer, multi-bot via `--profiles a.json b.json` | Node.js, MC ≤1.21.11 | MIT | **Best base.** Headless bots (≈100 MB each), multi-agent already, profiles ≈ our personalities, MIT lets us fork freely. Communication is global chat — we must replace it with proximity routing. |
| [Voyager](https://github.com/MineDojo/Voyager) | Lifelong-learning agent writing Mineflayer JS skills, skill library + automatic curriculum | Python + Mineflayer | MIT | Ideas: skill library, self-verification. Single-agent, older MC. |
| [Project Sid / PIANO](https://github.com/altera-al/project-sid) ([paper](https://arxiv.org/abs/2411.00114)) | 10–1000+ agents forming a civilization; PIANO = parallel modules (memory, social awareness, goal, action) with a coherence "bottleneck" | Report only, code not released | — | Architecture inspiration for our agent "mind" (parallel modules, social-awareness module ≈ our commander ToM). |
| [VillagerAgent / VillagerBench](https://github.com/cnsdqd-dyb/VillagerAgent) | Graph-based (DAG) task decomposition & assignment for multiple agents | Python + Mineflayer | — | Reuse the **task-DAG** idea for the commander's planner. |
| [PillagerBench](https://github.com/aialt/PillagerBench) | Competitive team-vs-team Minecraft MAS benchmark | Python + Mineflayer | — | Ideas for competitive/sabotage metrics. |
| [TeamCraft](https://github.com/teamcraft-bench/teamcraft) | Multimodal multi-agent benchmark, 55k task variants | Python | — | Task templates for evaluation. |
| [MineLand](https://arxiv.org/abs/2403.19267) | 64+ agents, **limited senses** (vision/hearing radius), physical needs | Python + Mineflayer | — | Validates our "can only hear nearby" design; reference for limited perception. |
| Minecraft MCP servers ([yuniko](https://github.com/yuniko-software/minecraft-mcp-server), [minecraft-mcp](https://github.com/Kagurazaka135/minecraft-mcp)) | Mineflayer exposed as MCP tools | TS | Apache/MIT | Option: give each agent's LLM its tools via MCP instead of a custom tool schema. |

## Decision (recommended)

* **Bodies:** Mineflayer (+ `mineflayer-pathfinder`, `mineflayer-collectblock`, later `mineflayer-pvp`,
  `mineflayer-armor-manager`). Fork/borrow Mindcraft's `skills.js` + command layer (MIT) rather than
  writing skills from scratch.
* **Minds:** our own Node.js layer (persona, memory, planner, ToM) talking to any OpenAI-compatible
  endpoint (currently DeepSeek v4.1 flash via OpenCode Go). Cheap model for workers, stronger model optional for commander.
* **Server:** Java Edition 1.21.4 (vanilla or Paper), offline mode, localhost.
* **Communication:** our own proximity message router (global chat is never used for semantics).
* **unionclef:** keep as a stretch goal (e.g., give the commander a "real" client body for nicer
  footage, or one elite agent), not as the base — per-agent cost and GPL are the blockers.

## Related research on hidden roles / deception
* AmongAgents (text Among Us), Avalon agent societies, Secret-Hitler LLM evaluations — show LLMs
  struggle to *sustain* deception and to *detect* it, which makes our commander-deduction metric
  a meaningful (non-trivial) research question.

## Reference videos (for "what it will look like")
* Emergent Garden's Mindcraft videos on YouTube (multi-bot LLM Minecraft, search "Emergent Garden mindcraft").
* Altera "1000 AI NPCs simulate a CIVILIZATION in Minecraft" (Project Sid).
* Our own prototype recording: `recordings/demo.mp4` (see README).
