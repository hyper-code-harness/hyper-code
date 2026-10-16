# Результаты инструментов: файловое хранение и ленивое чтение

Статус на 2026-10-15: недеструктивный файловый путь реализован, загружен в runtime и проверен. Аддитивная миграция `20330305120000_message_result_ref` применена. Подготовлена boot-only миграция `20330306120000_remove_legacy_scratchpad_results`: удаляет только верхнеуровневые `results` и `resultSeq`, сохраняет планы и флаги. На live она НЕ запускалась; проверки выполняются в изолированной тестовой БД. Полный сброс scratchpad не предусмотрен.

## Решение

- Маленькие результаты остаются в `messages.content` в Postgres, с `role = tool` и `tool_call_id`.
- Большие результаты — неизменяемые файлы `.hyper/results/<owner-agent-id>/<result-uuid>.json`. В сообщении — превью и структурированная ссылка.
- Чтение — только через `agent.readResult`, не через прямой доступ к `agent.scratchpad.results`.
- В памяти — индекс ссылок и короткоживущий кеш результатов. Файлы загружаются лениво. Кеш не сериализуется в БД и не копируется в форки.
- Из старых scratchpad удаляются только `results` и `resultSeq` верхнего уровня. Планы, история планов, заметки, флаги и любые другие поля сохраняются. Сообщения, события и настройки в отдельных колонках не меняются.
- Разрешение потерять старое состояние не означает, что можно сломать создание новых планов и работу процедур. Их дальнейшее хранение нужно определить до переключения.

## Устройство до реализации (историческая справка)

`agent.stashResult` сохраняет вывод длиннее 6 000 символов в `scratchpad.results.rN`, оставляет последние шесть результатов без лимита размера каждого и возвращает превью примерно до 2 500 символов. Подсказка предлагает читать через eval.

`session.save` и `session.updateScratchpad` сериализуют весь объект в текстовую колонку `agents.scratchpad`; `session.load` загружает его целиком. `session.mutateScratchpad` использует сравнение старого значения для конкурентной записи. `session.fork` глубоко копирует scratchpad. Планы и история планов также используют этот объект.

## Хранилища

| Данные | Хранилище |
|---|---|
| Настройки, очередь, сообщения, постоянное состояние | Postgres |
| Маленький результат | `messages.content` |
| Большой результат | Отдельный JSON-файл |
| Превью и ссылка большого результата | `messages.content` и новое `messages.result_ref` |
| Индекс ссылок и кеш содержимого | `ctx.state` выделенного namespace |
| Временные вычисления | Память, без гарантии восстановления |

Новый кеш не помещать в `agent.scratchpad`: старые общие пути сохранения могут снова сериализовать его. Логически это рабочая память результатов, технически — отдельный runtime-кеш.

## Файлы

```text
<instance-data-root>/.hyper/results/
  <owner-agent-id>/
    <result-uuid>.json
```

Корень единый для экземпляра Hyper и задаётся настройкой, не зависит от workspace агента и её SSH-хоста. Перед реализацией прочитать `docs/settings.md`. Каталог исключить из Git, runtime-сканирования и публичной файловой раздачи.

Пример формата:

```json
{
  "version": 1,
  "id": "<uuid>",
  "ownerAgentId": "<agent-id>",
  "createdAt": 0,
  "kind": "eval",
  "text": "Полный исходный вывод инструмента"
}
```

Вывод хранится как текст: не пытаться автоматически разбирать его как JSON. Размер считать в UTF-8 байтах. Запись — временный файл в том же каталоге, необходимый flush и атомарный rename; опубликованный файл не изменять.

Сначала записать файл, затем сообщение со ссылкой. Общей транзакции у диска и Postgres нет: сбой между этими операциями оставит файл без ссылки. Убирать такие файлы только после периода ожидания. При ошибке записи не публиковать успешную ссылку на несуществующий файл.

## Ссылка в сообщении

Добавить nullable JSONB `messages.result_ref`: `version`, `id`, `ownerAgentId`, `bytes`, `sha256`, `kind`. При необходимости — `alias`. Путь строится сервером из проверенных идентификаторов, а не принимается от модели.

UUID — основной идентификатор. В новых подсказках использовать UUID; новые `rN` не нужны для работы API. Старые `rN` относятся к сброшенным результатам и должны давать понятный ответ `legacy_unavailable`, а не разрешаться случайно в новый результат.

Протащить метаданные через типы, запись, загрузку, замену сообщений, экспорт/импорт и сборку истории форков. Провайдеру LLM отдавать обычный content и tool calls, без внутренних полей. Новое чтение не должно парсить ссылку из текста превью.

## API

```ts
await ctx.fns.agent.readResult({ id: "<result-uuid>" });
await ctx.fns.agent.readResult({ id: "<result-uuid>", offset: 0, limit: 4000 });
```

Текущий агент определяется из контекста сессии. Доступ проверяется по доступной истории, включая границу форка; знание UUID не даёт права читать чужой файл. Внутренним задачам без сессии нужен отдельный авторизованный путь.

Возврат: `ok` с `text`, `totalChars`, `offset`, `truncated`; ошибки `legacy_unavailable`, `expired`, `not_found`, `forbidden`, `corrupt`, `too_large`. На публичной границе рассмотреть объединение forbidden/not_found, чтобы не раскрывать существование чужого результата.

`offset` и `limit` — позиции строки JavaScript, с документированными пределами. Порядок: авторизация → разрешение ссылки → кеш → файл → проверка → диапазон. JSON первой версии может потребовать полного чтения и разбора даже для диапазона. Ограниченный ответ не равен ограниченной памяти чтения: нужен отдельный предел размера чтения. Настоящее потоковое чтение диапазонов — отдельное улучшение формата.

Обновить системный промпт, превью и собственные процедуры с прямым доступом к results. Проверить сохранённые systemPrompt. Старые сообщения не переписывать массово: их ссылки потеряны намеренно, и это явно сообщается пользователю/модели.

## Кеш Bun: короткий TTL и лимит объёма

Использовать `lru-cache` (npm), не Redis и не собственную реализацию LRU. Хранить экземпляр в `ctx.state` собственного namespace, не в глобальной переменной модуля и не в scratchpad.

Начальные предлагаемые настройки, уточняемые тестами:

- Idle TTL — 2 минуты после последнего чтения (`updateAgeOnGet`).
- `ttlAutopurge` — для удаления просроченного даже без последующего чтения.
- Общий `maxSize` — 64 МиБ, максимальный кешируемый элемент — 8 МиБ.
- `sizeCalculation` учитывает оценку памяти строк и метаданных, не только байты файла. Это лимит учёта кеша, не жёсткий лимит RSS процесса.
- Результат сверх лимита элемента можно читать в пределах отдельного безопасного лимита чтения, но не кешировать.
- При достижении лимита вытеснять по LRU раньше TTL; объединять параллельные загрузки одного файла.

Истёк TTL → удалить ссылку на содержимое из кеша. Файл и ссылка в messages остаются. Следующее обращение читает диск. Не удерживать вытесненные объекты в других коллекциях. Активное чтение держит свои ссылки до завершения; разрешённый доступ проверяется и при cache hit.

Не вызывать `Bun.gc()` на каждом вытеснении. GC освобождает недостижимые объекты, но RSS может не уменьшиться сразу. TTL памяти и TTL файлов независимы; автоматическое удаление файлов в первом выпуске выключено.

Индекс ссылок строить лениво, обновлять при изменении сообщений и доступной истории; не превращать его в другой неограниченный кеш. При hot reload не оставлять старые таймеры/экземпляры кеша.

## Форки, очистка и восстановление

Форк наследует ссылки из доступной истории, не файлы и не содержимое кеша. Собственные результаты записывает под своим owner-agent-id. Удаление исходного агента не должно удалять файлы, доступные другим веткам. Проверить семантику удаления родительской истории и при необходимости материализовать ссылки до её удаления.

Первый выпуск: без автоматического удаления файлов. Следующий этап — dry-run GC, согласованные TTL/квоты файлов, постоянные артефакты и учёт активного чтения. Различать временные файлы незаконченной записи, опубликованные orphan-файлы, истёкшие результаты и pinned-артефакты. Для `expired` нужна отметка намеренного удаления; отсутствие файла само по себе может означать повреждение.

Backup включает БД и каталог результатов. Несколько серверов требуют общего хранилища или маршрутизации чтения на сервер-владелец.

## План реализации

1. **Инвентаризация кода.** Через code.slice/code.callers найти читателей и писателей results, resultSeq, scratchpad, plan, fork, compact и sleep, включая плагины. Решить хранение новых постоянных данных. Потеря старых значений допустима, поломка новых операций — нет.
2. **Файловый слой и кеш.** Настройка корня, атомарная запись, формат файла, безопасное чтение, UUID, `lru-cache`, idle TTL, лимиты и тесты.
3. **Аддитивная схема.** `messages.result_ref` и типы, протягивание метаданных через все пути сообщений. Пока не удалять agents.scratchpad.
4. **Новый API и запись.** Создать `agent.readResult`, изменить stashResult на возврат превью вместе с ссылкой, обновить вызывающие процедуры. Большие результаты больше не пишутся в scratchpad, маленькие остаются inline. Старые ссылки возвращают legacy_unavailable; fallback/backfill не реализуются.
5. **Промпты и форки.** Заменить инструкции прямого доступа на readResult. Не копировать results в форки. Устранить сериализацию нового кеша через save/update/mutate.
6. **Тесты и переключение.** Пробный агент, рестарт/восстановление, TTL, нагрузка, права, fork, обработка ошибок диска. Зафиксировать working version и backup для отката.
7. **Очистка legacy-результатов.** Выполнить boot-only миграцию по протоколу ниже; полный сброс scratchpad запрещён.
8. **Проверка после очистки.** Старый кеш не возвращается из памяти, новые результаты читаются с файлов, планы и другие функции создают новое состояние корректно.
9. **Отдельные дальнейшие работы.** Удаление самой колонки только после устранения всех её потребителей; GC файлов после согласования; уплотнение PostgreSQL отдельно с оценкой блокировок и места.

Новые runtime-функции создавать через procs.dev.createFunction. Не использовать cross-imports. После изменений — hot reload, genTypes при изменении набора файлов, strict docs validation с typecheck и code.quality, тесты. Обычные изменения загружаются без перезапуска; для сброса нужны контролируемая остановка записей и синхронизация live state.

## Одноразовая очистка legacy-результатов: порядок и защита

Миграция `20330306120000_remove_legacy_scratchpad_results` идёт после `message_result_ref`. Она удаляет **только** два верхнеуровневых ключа `results` и `resultSeq` из JSON-объектов в `agents.scratchpad`. Все остальные поля, включая `plan`, `planHistory`, флаги и вложенные одноимённые ключи, сохраняются. JSONB сохраняет точность больших чисел (нет JS JSON round-trip); форматирование изменённых объектов может нормализоваться. Строки без этих ключей не переписываются.

Невалидный JSON, SQL NULL, JSON null, массивы, строки и другие не-объекты остаются без изменений. Значения, которые PostgreSQL не может представить в JSONB (например, `\u0000` или число вне диапазона), тоже пропускаются. PostgreSQL NOTICE сообщает только количества changed/malformed/non_object, без содержимого. Такая миграция не исправляет ранее повреждённый JSON для session.load — это отдельная задача, без потери исходных данных.

### Безопасный запуск только при холодном старте

1. Сохранить backup; остановить **все** процессы-писатели этой БД. Guard видит только текущий процесс и не заменяет этот операционный барьер.
2. Запустить новую версию обычным boot. `package.json → procs.prod` задаёт порядок `procs/db → procs/migrate → agent`; `procs.lifecycle.order` дополнительно переносит HTTP в конец. `procs.lifecycle.start` последовательно **await**-ит каждый hook. Ошибка обязательного `procs/migrate` прерывает boot, agent и HTTP не запускаются.
3. `procs/migrate/$start.ts` ожидает завершения `migrate.up`; тот применяет новую миграцию до `agent/$start.ts`. Только затем агентский hook вызывает `session.loadAll`, а после него ставит `workerLoop` в microtask. Старые результаты поэтому не попадают в память и не могут вернуться через поздний save. `AGENT_WORKER=off` сам по себе недостаточен: loadAll всё равно выполняется.
4. Не запускать общий `migrate.up` вручную в live runtime. Миграция отклоняет выполнение, если загружены агенты, есть worker promise либо lifecycle уже запустил agent/HTTP. Hot reload не является применением миграции; контролируемый boot — отдельная операция.
5. После старта проверить `_migrations`, сохранность планов/флагов и новый путь readResult. Никакие сообщения, события, файлы результатов, timestamp или другие колонки миграция не меняет.

Все обновления выполняются одним PostgreSQL DO statement: ошибка откатывает весь statement; строки блокируются FOR UPDATE. Оператор `?` не используется, чтобы не конфликтовать с placeholders framework DB. `_migrations` — одноразовый durable marker; framework записывает его после успешного `up`. Между cleanup и marker возможен crash: повторное выполнение безопасно, потому что удаляются только те же два устаревших ключа, а остальные данные не затрагиваются. Отдельный down не предусмотрен: удалённые legacy bodies можно вернуть только из backup.

### Проверки

`bun test src/session/legacyScratchpadMigration.test.ts` использует штатный test harness: отдельный PostgreSQL на :54399, worker database `hyper_test_*`, не live :54393. Тесты проверяют удаление обоих/одного ключа, сохранность plan/history/flags и точности числа, пустые объекты/отсутствие ключей, byte-for-byte сохранность malformed/null/array/string, повторный запуск, атомарный rollback, live guard и реальный lifecycle order с чтением очищенного состояния через loadAll до worker. Общий migrate.up в тесте вызывается только в изолированной тестовой БД.

### Откат

Перед очисткой — backup. При проблемах нового пути остановить новые записи, сохранив файлы и ссылки. Старый код не понимает file-only результаты: нельзя просто откатить бинарник и считать данные читаемыми. Использовать совместимое исправление либо согласованное восстановление БД и файлов с учётом новых записей.

## Критерии готовности

- Малые результаты inline, большие точно восстанавливаются из файла, включая Unicode, переносы и NUL.
- Загрузка агента не читает все файлы; readResult работает после холодного старта.
- TTL удаляет содержимое кеша без удаления файла; чтение обновляет idle TTL. LRU и maxSize работают под нагрузкой, большие элементы не кешируются.
- Новый кеш не появляется в agents.scratchpad ни через save, ни через mutate, ни через fork.
- Форк не копирует файлы и не читает будущие сообщения родителя. Чужой UUID и traversal не дают доступ.
- Конкурентные чтения, записи и hot reload не создают утечек кеша/таймеров; ошибка диска не создаёт ложную успешную ссылку.
- Сбои между rename и записью сообщения оставляют обнаружимый orphan-файл.
- Старый rN даёт legacy_unavailable, не чужой новый результат.
- После очистки legacy results не возвращаются из live agents; существующие планы и флаги сохранены, создание новых планов и настройки работают.
- Backup/restore и экспорт/импорт учитывают файлы; удаление родителя не ломает доступные другим веткам результаты.

Метрики: размер каталога, учётный размер кеша и RSS, cache hit/miss/evictions, длительность чтения, missing/corrupt/expired, ошибки записи, наличие results в agents.scratchpad.

## Фактическая реализация и проверки

- `resultStore.instanceRoot` / `HYPER_INSTANCE_DATA_ROOT`: абсолютный локальный корень (default — cwd сервера, не workspace/SSH). Под ним `.hyper/results`; конфигурация корня доверенная, canonical root согласован. Owner/file symlinks отвергаются. Files HTTP/raw/embed и UI скрывают приватные файлы и aliases; scanner и git исключают payloads.
- `resultStore.write`: UUID, mode 0700/0600, exclusive temporary file, fsync, rename, fsync каталога. Текст ≤32 МиБ UTF-8; JSON stat limit 200 МиБ. SHA-256/bytes относятся к тексту. Ошибки дают честный bounded failure preview без ссылки.
- `agent.readResult`: session identity, видимая история и fork offset, UTF-16 диапазоны (default 4000, max16000). Storage read повторно авторизует все поля ссылки до cache hit. Foreign/unknown UUID одинаково not_found; expired зарезервирован, GC отсутствует. rN всегда legacy_unavailable.
- LRU в ctx.state.resultStore, idle TTL120s/updateAgeOnGet/autopurge, maxSize64МиБ, maxEntrySize8МиБ, UTF-16+metadata accounting. Это fixed v1 defaults, не настройки. Pending loads deduplicated и удаляются finally; reload использует один state/cache. Отдельный индекс истории не кешируется: auth перечитывает историю каждый раз (latency tradeoff, без stale ACL).
- result_ref проходит append/update placeholder/get/replace/inheritance; LLM payload без внутренних полей. session.save сохраняет только state/settings, не переписывает messages/events и их result_ref; отдельный inheritedMessageCount больше не нужен. Fork исключает legacy results/resultSeq, сохраняет планы. Compact меняет только own rows. Удаление родителя с форками запрещено; transactional concurrent-delete защита — будущая работа. Автоматического удаления файлов нет.
- Планы, история планов и прочее постоянное состояние остаются в agents.scratchpad; новый cache туда не помещается. Старые scratchpads не очищены и сохраняются как раньше до отдельно согласованного reset.
- Проверки: 80 pass/0 fail/455 assertions в21 focused/regression файле. Storage:15 tests/186 assertions (unicode/NUL/limits, corruption/missing, traversal/symlinks, TTL/LRU, dedupe, auth/fork). TTL проверен с контролируемым коротким per-entry TTL. Crash/fsync fault injection и настоящий backup restore не выполнялись.
- Независимый агент cdcp (test-result-store, parentId=null) получил preview без контрольной строки, сам вызвал readResult UUID offsets4000/8000 и восстановил orchid-6729-cobalt. После cache.clear повторил disk read300 units; r123→legacy_unavailable. Persisted tool calls/ref проверены, scratchpad без results. Чат оставлен.
- Runtime функции hot-reloaded и strict docs/typecheck пройдены; genTypes успешен. Общий tsc имеет ошибки вне change set; глобально зелёная сборка не заявляется. code.quality ok:true/errors:0/warnings:487.
- Deployment incident: stash загрузился до write provider, временно отдавал storage-failure preview без полного output. Provider восстановлен; live stash→DB ref→authorized read/cache smoke успешен. Вывод этого окна не обещается восстановимым.
- Scope incident: общий migrate.up финальной проверки также применил чужую pending additive 202607170001_initial (CREATE hypermail schema/tables), без удаления данных. Откат не выполнялся. В дальнейшем применять только согласованную migration, не весь pending queue.

Backup включает Postgres И каталог результатов. DB-only export/import переносит ссылки, не payloads. Multi-server требует shared storage. GC, tombstones/expired, pinned artifacts, метрики, privileged service reader и streaming format вне v1. Boot-only cleanup выше реализован и проверен в test DB; на live не применялся.


## Перенос на другую машину (порядок выкладки)

1. Не переносить локальные `.env`, backups, `.runtime` и payloads через Git. Сначала сохранить согласованный backup Postgres и каталога результатов. Для уже существующих ссылок перенести соответствующие файлы отдельно безопасным способом; DB-only копия недостаточна.
2. В отдельном release-каталоге выполнить `bun install --frozen-lockfile`: требуется `lru-cache@11.5.3`. Не загружать новый `stashResult` раньше `resultStore` и зависимостей. Зафиксировать абсолютный `HYPER_INSTANCE_DATA_ROOT`, доступный серверному пользователю на запись; смена cwd или настройки сама файлы не переносит. Для нескольких серверов с общей БД нужен общий доступ к тому же хранилищу.
3. Аддитивный этап схемы — `20330305120000_message_result_ref`: `ALTER TABLE messages ADD COLUMN IF NOT EXISTS result_ref JSONB`. В runtime использовать `ctx.fns.procs.db.exec`; проверить `information_schema.columns` и учёт миграции в `_migrations`. Не запускать весь pending queue вслепую: он может содержать чужие миграции. Старый код совместим с добавленной nullable-колонкой.
4. Проверенный по исходникам штатный startup: `bun run start` → `src/$main.ts` загружает функции и routes → lifecycle запускает секции `package.json.procs.prod` по порядку: `procs/db`, `procs/migrate`, затем `agent`, затем `procs/http`. Поэтому обычный startup применяет ВСЕ pending migrations до worker/HTTP; заранее проверить их полный список на целевой машине. При hot reload такого барьера нет: сначала схема и providers, потом persistence/readers и guards, последними `stashResult`/`run`. На период переключения остановить/дождаться активных писателей, иначе возможен storage-failure preview без полного вывода.
5. Проверить малый inline и большой результат: persisted `result_ref`, чтение UUID авторизованным агентом, cold-cache чтение с диска, отказ чужому агенту, запрет HTTP-доступа к payloads; проверить права каталогов/файлов и backup. Только затем возобновить обычную нагрузку. Полный сброс scratchpad запрещён. Новая boot-only миграция удалит только legacy results/resultSeq после остановки всех писателей; остальные поля останутся.

Этот порядок проверен по локальному startup-коду; установка, миграции и smoke на других машинах здесь НЕ выполнялись. Rollback не должен удалять колонку или файлы; старый код не умеет читать новые file-only результаты. Требуется совместимый reader либо согласованное восстановление обоих хранилищ.

## Follow-up after 63d3885: shared preparation and authorization

Implemented `resultStore.prepare` for oversized text storage and bounded preview/failure handling. Tool callers retain the 6,000-character inline threshold and bash tail semantics; triggers serialize JSON once and retain a separate 16,000-character threshold. Both use 2,500-character oversized previews even when storage fails. Serialization failures use an explicit unavailable placeholder, never invalid JSON or a dangling reference.

`agent.readResult` now passes the UUID directly to `resultStore.read`; authorization occurs once per read inside storage before cache/pending lookup. The backward-compatible structured `ref` input still requires matching durable metadata. No authorized flag or cache shortcut exists. History is not cached, so revocation and fork visibility are checked on each read.

Parent-approved provider-first hot reload and strict validation succeeded for prepare/read/readResult/stashResult/processTrigger; an existing live UUID read succeeded. No migration, GC, backup restore, restart, commit or push was performed in this follow-up. Trigger finalization and audit insertion are atomic, but prompt delivery remains outside that transaction and may repeat after a crash. See `docs/trigger-results-storage.md` for exact verification counts and remaining limits; the complete fast suite still has baseline failures.
