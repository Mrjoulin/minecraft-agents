# HANDOFF — состояние проекта на 2026-11-01 (~19:15)

Документ для перезапуска контекста. Актуальная пачка изменений зафиксирована
в git-истории ветки `feature/updates` (фикс OOM + инструментарий + фолбэк сбора).

## 1. Общее состояние

- Тесты: **132/132** (`npm test`, ~5 с).
- **ГЛАВНАЯ ПРОБЛЕМА ПРОШЛЫХ СЕССИЙ (OOM живых GLM-прогонов) НАЙДЕНА, ПОЧИНЕНА
  И ПРОВЕРЕНА ДВАЖДЫ.**
  - 5-минутный прогон: exit 0, east wall 9/9, хип ~80–95 МБ.
  - **15-минутный прогон (`SESSION_MS=900000`): exit 0, хижина ПОЧТИ ГОТОВА —
    north 15/15, south 13/13, west 9/9, ROOF 25/25, east 6/9**; Odo собрал 34 /
    сдал 28 / уложил 41 блок, Bram 16/9/29, Lina 4/4/4. 72 LLM-вызова.
    **Хип за 191 сэмпл максимум 109 МБ — плоский все 15 минут.**
  - Все 90 ошибок в длинном прогоне — сеть юзера («fetch failed» до Z.ai,
    пачками): 81 ретрай + 9 финальных отказов после лестницы ретраев; сессия
    пережила всё (итоговые вердикты 0/3 — сеть легла на финальном опросе).
  - Логи: `logs/run-2026-11-01T09-39-38-610Z.jsonl` (5 мин),
    `logs/run-2026-11-01T15-26-38-409Z.jsonl` (15 мин).
- Сервер Minecraft: ЗАПУЩЕН (сид 42; после простоя сам «pausing» — это норм).
- Единственная недостроенная стена (east 6/9) — нехватка брёвен/время, не баг:
  сбор и стройка работают в обеих сессиях.

## 2. Причина OOM (для истории)

Микротаск-голодание event loop'а собственным кодом, НЕ чанки и НЕ mineflayer:

1. `approachPlayer` (src/skills.js) имел мгновенные возвраты без единого
   таймера: «цель уже в радиусе» → instant-true; «цели нет/кикнута» →
   instant-false.
2. Цикл воркера (worker.js `loop`) перезапускал действие без sleep →
   `await` на resolved-промисах = чистая микротасковая очередь → таймеры
   никогда не выполняются → весь event loop замерзает.
3. Замерший loop не дренирует сокеты: входящие пакеты сервера копятся
   (~100 МБ/с в проде → 4–6 ГБ к OOM), боты пропускают keepalive → сервер
   кикает («Timed out») → `bot.players` пустеют → null-путь закрепляет спин
   навсегда.

Триггер в прогонах: `follow_commander`, когда воркер дошёл до командира
(№6: 66 с, №7: 55 с, №8: 110 с).

Диагностика (всё осталось в scripts/, пригодится):
- `scripts/repro-follow.cjs` — минимальное репро (target ходит квадратом,
  follower крутит боевой approachPlayer). До фикса замерзало <1 с, после:
  180 с, NO_FREEZE, 141 heartbeat.
- `scripts/forensics.cjs` — CPU-профиль / брейкпоинт / сэмплирующий
  heap-профайлер через inspector на ЖИВОМ (в т.ч. замерзшем) процессе:
  V8 обслуживает инспекторские прерывания даже в голодном loop.
  `node -e "process._debugProcess(pid)"` активирует инспектор на лету.
- `scripts/analyze-heap.cjs` — стриминговый разбор .heapsnapshot (nodes+strings,
  edges пропускаются), проверен на живом 74 МБ снапшоте.

Фикс (три слоя):
- `approachPlayer`: instant-true → sleep 100 мс; null-target → sleep 100 мс.
- worker.js `loop`: после действия короче 100 мс — sleep до TICK_MS.
- Джанинер чанк-колонок `pruneColumns` (createBody, params.yaml
  `world.column_janitor`: 12 чанков / 30 с) — гигиена; гипотеза «чанки съедают
  хип» НЕ подтвердилась (бейзлайн ~160 МБ на 4 ботов, колонки ~330/бот).

## 3. Второй починенный баг: «все направления пусты» (направленный сбор)

С якорем направления `findReachableLog` возвращал одно и то же якорно-ближайшее
дерево; collect падал по нему 4 раза → «0 бревен». Теперь failures добавляют
позицию в blacklist и ретрай берёт следующего кандидата. Примечание: до этого
фикса прогон всё равно продвинулся (LLM переключал на `direction: any`).

## 4. Новый инструментарий памяти

- `src/heap-watch.js` (включается HEAP_WATCH=1 в index.js): каждые 5 с событие
  `heap` в run-лог (heapMb/rssMb/externalMb + колонки на бота);
  `HEAP_SNAPSHOT_AT_MB` / `HEAP_SNAPSHOT_AT_MS` — авто-снапшот (однократный).
  ВАЖНО: `--heapsnapshot-near-heap-limit` НЕ ИСПОЛЬЗОВАТЬ — даёт 0-байтовый
  файл (умирает до флаша; проверено дважды).
- На здоровом хипе снапшот не нужен: кривая heap-watch показывает всё.

## 5. Как перезапустить всё

```bash
export PATH="/c/Program Files/nodejs:/c/Program Files/Eclipse Adoptium/jdk-21.0.13.9-hotspot/bin:$PATH"
cd /c/Users/PC/Desktop/minecraft-agents
# сервер (если не запущен):
( cd server && rm -f console.in && touch console.in && (tail -f console.in | java -Xmx3G -jar server.jar nogui > server.log 2>&1 &) )
# ждать "Done (" в server/server.log, затем:
NODE_OPTIONS=--max-old-space-size=6144 HEAP_WATCH=1 VIEWER=0 SESSION_MS=300000 node src/index.js > logs/demo.out 2>&1
# стаб-режим без ключа: добавить LLM_STUB=1
# тесты: npm test   (пишут logs/run-*.jsonl — сайд-эффект, это норм)
# сводка прогона: node scripts/summarize.js logs/run-<...>.jsonl
```

Остановить всё: `echo stop >> server/console.in` + kill node + taskkill //IM tail.exe.

## 6. Файлы пачки (зафиксированы коммитом в feature/updates)

- src/skills.js: approachPlayer (2 anti-starvation sleep), pruneColumns + джанинер
  в createBody, collectLogs blacklist-фолбэк
- src/agents/worker.js: макротаск-yield в loop
- src/heap-watch.js (НОВЫЙ), src/index.js: подключение heap-watch
- test/heap-watch.test.js (НОВЫЙ), test/skills.test.js: +3 теста (2 анти-спин,
  1 фолбэк сбора)
- scripts/: +analyze-heap.cjs, +forensics.cjs, +profile-stuck.cjs (слабее
  forensics, оставлен), +repro-follow.cjs, +probe-trees.cjs (read-only зонд
  миров ботов)
- params.yaml: world.column_janitor
- CHANGELOG.md (0.1.4), README не менялся в этой части
- НЕ коммитить: .env (ключ юзера), *.heapsnapshot в корне
  (Heap.20261101.121111…, 74 МБ, здоровый бейзлайн — можно удалить)

## 7. Что дальше

1. Коммит пачки по просьбе юзера (атрибуция: Co-Authored-By: Claude Opus 5.5).
   Косметический хвост: 3 блока восточной стены (сбор/стройка работают — просто
   не хватило времени/брёвен за 15 мин).
2. Viewer (порт 3007) всё ещё отключён; если включать — ограничивать
   viewDistance / периодический рестарт мешей.
3. pza_… ключ (polza.ai) потерян из .env — фолбэк-маршрут не сохранён.
4. Сеть юзера нестабильна (fetch failed пачками) — при желании можно поднять
   число ретраев/таймауты LLM (LLM_MAX_ATTEMPTS, LLM_RETRY_BASE_MS).
5. ~80 свиней в params.yaml pastures — НАМЕРЕННО, не чинить.
