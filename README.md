# Minecraft Multi-Agent System — Commander & hidden-persona agents

University project. A **commander** agent gets an ultimate goal and leads 3–5 **sub-agents** in Minecraft.
Each sub-agent has a hidden personality trait and a secret motive. The commander does not know them;
it has to work them out by watching, and it can only give orders in person.

* `docs/RESEARCH.md`: prior art and technology choice (unionclef, Mindcraft, Project Sid, VillagerAgent, …)
* `docs/ARCHITECTURE.md`: components and information boundaries
* `docs/ROADMAP.md`: 5 stages × 2 weeks with demo and metrics per stage
* `site/index.html` (`site/index.ru.html` in Russian): shareable plan page with the embedded demo
* Demo videos, run logs and the Minecraft server are not in the repository (too large, or not redistributable).
  `scripts/render-overlay.js` and `scripts/compose-video.sh` rebuild a demo video from a recording and its `logs/run-*.jsonl`.

## What the prototype already does (demo scenario)

| Agent | Public | Hidden trait (GM only) | Secret motive (GM only) |
|---|---|---|---|
| Commander | team leader | — | — |
| Bram | stocky woodcutter | fears the dark | wants the best armor |
| Lina | cheerful explorer | loves animals | wants the most diamonds |
| Odo | quiet, efficient worker | diligent | secretly hoards resources |

Goal: *build a small wooden hut next to camp before night*. Workers gather logs into the camp chest. Then each worker takes logs, crafts planks and builds the wall or roof section the commander assigns (5×5 hut, 71 blocks; `src/blueprint.js`). When the hut stands, the commander crafts a crafting table and a door and hangs the door. Night falls about 4 minutes in.

The recorded demo video shows the earlier log-gathering-only version of the scenario.

* **Real game:** vanilla Java 1.21.4 server, Mineflayer bots. Pathfinding, chopping, chests and item hand-over all happen in the game.
* **LLM minds:** DeepSeek v4.1 flash through an OpenAI-compatible endpoint. Workers reply with `{thought, say, action}`; the commander replies with `{beliefs, decisions, watch}`.
* **Proximity speech:** everything said is delivered only within 4/14/40 blocks (whisper/talk/shout). An order counts only when the commander stands within 6 blocks of the worker. Agents nearby overhear it.
* **Hidden personas:** part of each persona is enforced in code so it can be seen (Bram refuses to work in the dark, Lina leaves work to follow animals, Odo deposits only half of what he collects). The LLM adds speech and choices on top.
* **Non-disclosure guard:** if an agent states its trait or motive outright, the speech is redacted before anyone hears it, and the event is logged.
* **Commander's eyes:** the commander gets evidence only from what is within 28 blocks: chops it sees, who stands by the fire or next to animals, chest audits. It never reads personas.
* **Incentives:** rewards are emeralds handed over in the game. Punishments are warnings or fines, and the worker's LLM decides whether to comply.
* **Ground-truth reveal and scoring** at the end of each session.
* **Spectator dashboard:** 3D view (prismarine-viewer) plus the speech feed with who heard what, private reasoning, and the belief table. Every event is also written to `logs/run-*.jsonl`.

## Run it

Requirements: Java 21, Node 22, ffmpeg (for recording), Chrome (for recording).

```bash
npm install
cp .env.example .env               # put your OpenCode (or any OpenAI-compatible) key here
```

Download the official 1.21.4 `server.jar` from Mojang into `server/`, create `server/eula.txt` with
`eula=true` once you have read and accepted the Minecraft EULA, and use `online-mode=false` with `server-ip=127.0.0.1`.

The world is reproducible: `server/server.properties` pins `level-seed=42`, and the camp coordinates in
`params.yaml` were placed by `scripts/survey-seed.js` on the flattest dry patch near spawn (ground at y≈70).
`scripts/reset-world.sh` stops the server and deletes the world so the next start regenerates the exact
same terrain from the seed.

```bash
./scripts/start-server.sh          # terminal 1
```

```bash
npm run demo                       # terminal 2, then open http://127.0.0.1:3100
```

```bash
node scripts/record.js 370 recordings/raw/run.webm   # optional, terminal 3
```

To record with a real Minecraft client, start the demo with a start gate:

```bash
WAIT_FOR_START=1 npm run demo
```

Then join `127.0.0.1` with a Java 1.21.4 client. You become a spectator automatically. Set up your recording, then type `!start` in chat (or press Enter in the demo terminal). Agent speech is mirrored into the in-game chat; set `MIRROR_CHAT=0` to turn that off.

```bash
node scripts/summarize.js          # readable timeline of the latest run
```

```bash
./scripts/reset-world.sh           # restore the pristine world between runs
```

`npm test` runs the unit tests (speech radius and overhearing, order range, guard, JSON parsing, scoring).

## Layout
```
src/config.js           settings (radii, ports, model)
src/llm.js              OpenAI-compatible JSON client
src/speech.js           proximity speech bus
src/guard.js            non-disclosure guard
src/personas.js         trait / motive catalogue + demo roster
src/skills.js           Mineflayer body actions
src/agents/worker.js    sub-agent mind
src/agents/commander.js commander mind
src/agents/observer.js  commander's evidence extractor
src/gm.js               game master (console commands, sunset, reveal, scoring)
src/dashboard/          spectator UI (SSE)
scripts/                record, summarize, reset world, start server
```
WINDOWS UPDATE