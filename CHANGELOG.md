# Changelog

Все заметные изменения проекта документируются в этом файле.

## [0.1.2] — 2026-10-30

### Added
- **Алгоритмическая заглушка LLM** (`src/stub-llm.js`): тот же контракт `askJson`
  (те же промпты, те же валидаторы), эвристическая политика вместо сети.
  - `LLM_STUB=1 npm run demo` — полный прогон без API-ключа;
  - тесты гоняют весь конвейер решений без LLM и сервера.
  - Политики: worker — при явном приказе строить строит (или сначала добирает
    брёвна), иначе сдаёт носильное в сундук; commander — сначала «всем собрать
    по 6 брёвен», при >= 8 в сундуке — приказ строить секцию, финал — честное
    «не знаю».
- **`src/items.js`** — реестр абстрактных предметов (`logs`, `planks`,
  `emerald`, `stone_axe` → regex инвентаря) и чистая `depositShare`
  (скиппинг половины у hoarder'а вынесен из тела в чистую функцию).

### Changed
- **Абстрактные действия worker'а** (LLM решает, *что* нести/складывать):
  - `collect_logs` → `collect {item}` (пока только `logs` — рубить можно их);
  - `deliver_to_chest` → `deposit {item, n}` — авто-доставка после `collect`
    удалена: сдача в сундук теперь отдельное решение модели;
  - `give_logs_to_commander` → `give {item, n}`;
  - `build_section`, `wait_at_camp`, `follow_commander` — без изменений.
- `validateDecision` теперь публичный (экспорт) и валидирует `item`:
  неизвестный вид предмета или `collect` не-брёвен отклоняется.
- Системный промпт worker'а описывает действия через предметы.

### Tests
- 28 тестов (было 13): `test/actions.test.js` — валидация абстрактных
  действий и реестр предметов; `test/stub-driver.test.js` — политики
  заглушки для worker и commander на реальных промптах и реальных
  валидаторах.

## [0.1.1] — 2026-10-30

### Fixed
- **Патфайндер к сундуку** (`src/skills.js`): повторяющиеся ошибки
  `Took too long to decide path to goal!` при сдаче брёвен в сундук.
  - `goNear` теперь делает лестницу ретраев (`pathRetryPlan`): сброс цели,
    пауза 600 мс на «успокоение» физики и повтор с более широким радиусом.
  - `depositToChest` подходит к сундуку с разных сторон (`approachSides`),
    чтобы не повторять один и тот же провальный план A*.
  - `pathfinder.thinkTimeout` поднят 4000 → 8000 мс.

### Added
- **`params.yaml`** — все константы симуляции в одном файле:
  - `speech`: радиусы слышимости (whisper/talk/shout), дальность приказа, обзор командира;
  - `session`: длительность, время заката, каденции commander/worker, память агента;
  - `path`: таймауты и ретраи A*, поиск брёвен, попытки deposit;
  - `observer`: частоты наблюдения командира;
  - `world`: координаты лагеря, точки деревьев, пастбища, параметры заката.
- Чтение `params.yaml` в `src/config.js` (`config.params`); значения
  перекрываются env-переменными как раньше (`SESSION_MS`, `SUNSET_AT_MS`,
  `MC_*`, `VIEWER_PORT`, `DASHBOARD_PORT`).
- Тесты `test/params.test.js`: валидность секций params.yaml, зеркалирование
  в config, `pathRetryPlan` (расширение радиуса + пауза), `approachSides`
  (4 различные точки подхода).

### Changed
- Константы перенесены из кода в `params.yaml`: `config.js`, `skills.js`,
  `gm.js`, `index.js`, `agents/worker.js`, `agents/commander.js`,
  `agents/observer.js`.

### Windows support
- Заменили named pipe `server/console.fifo` (не работает между MSYS и
  нативными процессами) на обычный файл `server/console.in`:
  скрипты дописывают команды, `start-server.sh` пьёт его через
  `tail -f` в stdin сервера.
- `scripts/start-server.sh` переписан под эту схему.

## [0.1.0] — до 2026-10-30

Начальный прототип: commander + 3 workers со скрытыми персонами,
Mineflayer-боты, LLM-мозги (OpenAI-совместимый эндпоинт), близостная речь,
guard неразглашения, spectator dashboard (SSE + prismarine-viewer),
jsonl-логи и юнит-тесты.

### Окружение, развёрнутое 2026-10-30 (не в git)
- Node.js 26 LTS, Temurin JDK 21 (winget).
- `server/server.jar` — официальный vanilla 1.21.4 с Mojang
  (sha1 `4707d00eb834b446575d89a61a11b5d548d8c001`), `eula.txt`,
  `server.properties` (`online-mode=false`, `server-ip=127.0.0.1`).
- Первые успешные прогоны: агенты говорили, собирали брёвна, скрытые черты
  проявлялись (Брам уходил к костру на закате, Лина отвлекалась на свиней).
