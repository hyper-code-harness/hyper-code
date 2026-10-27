# Парковка агентов при исчерпании usage limit

Что происходит, когда у провайдера кончилась квота подписки, и как система
должна вести себя вместо того, чтобы биться в стену.

Статус документа: **основной parking flow реализован**. Failure classification, credential-group parking, durable wake at reset, usage snapshots, UI controls, multi-account model prefixes and fallback models работают. Ниже сохранены исходная мотивация и дальнейшие расширения; ранний раздел «что происходит сегодня» описывает поведение до реализации.

---

## 1. Историческая проблема до parking implementation

Реальный путь ошибки, по шагам, с настоящими именами файлов.

1. `llm.streamCodex` получает от `https://chatgpt.com/backend-api/codex/responses`
   ответ `429` с телом:

   ```json
   {"error":{"type":"usage_limit_reached","message":"The usage limit has been reached",
     "plan_type":"prolite","resets_at":1787219899,"eligible_promo":null,
     "resets_in_seconds":319357}}
   ```

2. `isRetryable(429, body)` в `streamCodex.ts:146` возвращает `true` →
   **4 попытки** с бэкоффом 1с / 2с / 4с. Квота от этого не появляется.
3. Бросается `Error("codex 429: {…сырой JSON…}")`.
4. `agent.run` пробрасывает наверх, `agent.workerLoop` ловит в `runOne`:
   - `session.appendErrorEvent` — событие `error` + тост с сырым JSON;
   - `last_error` пишется в строку `agents`;
   - `last_processed_msg_idx` **не двигается** — сообщение пользователя
     остаётся непрочитанным (это правильно и сохраняется).
5. Регексп «transient» (`workerLoop.ts:173`) матчит подстроку `429` →
   **ещё один прогон** через 10 секунд → ещё 4 попытки → падение.
6. Итог: `run_state='idle'`, в статусбаре красный бейдж
   `error: codex 429: {"error":{"type":"usage_limit_reac` (обрезано на 48
   символов). Дальше не произойдёт ничего, пока человек не напишет сообщение.

Цена ошибки: **8 бесполезных HTTP-запросов на агента**. На момент написания в
базе 14 живых агентов на `codex:gpt-5.6-sol` — это ~110 запросов в закрытую
дверь, 14 красных тостов и 14 остановленных диалогов, требующих ручного
тыка. При этом ответ сервера содержит точное `resets_at` — момент, когда
работу можно продолжить, — и он просто выбрасывается.

## 2. Как это решают другие

Смотрели `~/codex` (codex-rs), `~/claude-code`, `~/pi-mono`.

| | codex-rs | claude-code | pi-mono |
|---|---|---|---|
| Тип ошибки | `CodexErrorDetails::UsageLimitReached` — отдельный вариант | `APIError` + разбор заголовков | разбор JSON тела |
| Ретраи | `is_retryable() == false` | 429 → cooldown, не ретрай | `isRetryableError` (ретраит, минус) |
| Серверная задержка | `retry_delay()` из ответа уважается | `Retry-After` обходит собственный `maxDelayMs` | — |
| Знание до отказа | — | `anthropic-ratelimit-unified-5h/7d-utilization|reset` на **каждом** ответе | — |
| Состояние | `RateLimitSnapshot` в сессии | глобальный `{status:'cooldown', resetAt, reason}` в `fastMode.ts` | — |
| Смена модели | `should_retry_with_current_model()` включает лимит | `FallbackTriggeredError` → `fallbackModel`, сообщение «Switched to Sonnet…» | — |
| Текст | «Usage limit reached. You've reached your usage limit…» | «You've used 82% of your weekly limit · resets 14:30» | «You have hit your ChatGPT usage limit (prolite plan). Try again in ~N min.» |

Три вывода, которые берём:

1. **Лимит подписки — не транзиентная ошибка.** Ретраить его нельзя вообще.
2. **Состояние живёт выше отдельного запроса.** У claude-code это cooldown на
   провайдера; пока он активен, запросы просто не отправляются.
3. **Сервер сам говорит, когда можно.** `resets_at` / `Retry-After` — это
   директива, а не подсказка.

Чего у них нет и что есть у нас: **durable-воркер**. codex и claude-code — CLI,
они живут одну сессию, поэтому максимум, что могут — cooldown в памяти и текст
«попробуйте позже». У нас есть `agents.wake_at` и `agent.deliverWakes`,
переживающие рестарт. Значит агент может продолжить работу **сам**, через
трое суток, без человека.

## 3. Целевое поведение

### 3.1 Парковка

Агент, упёршийся в лимит, переходит в состояние **parked**: он не в ошибке, он
ждёт. Три свойства:

- в UI — жёлтая метка «припаркован», а не красная «ошибка»;
- в базе стоит `wake_at = resetsAt + джиттер`;
- `last_error` очищен: поломки нет, поэтому и «send a message to retry» —
  вредный совет.

Курсор `last_processed_msg_idx` не двигается, как и сейчас, — сообщение
пользователя остаётся непрочитанным и будет обработано после пробуждения.

### 3.2 Парковка групповая, по провайдеру

Квота принадлежит **провайдеру** (точнее — учётной записи внутри провайдера),
а не агенту. Первый агент, получивший `usage_limit_reached`, паркует все
незаархивированные агенты с тем же провайдером в модели:

```sql
UPDATE agents
   SET wake_at = ?, wake_reason = ?, next_run_at = NULL, last_error = NULL
 WHERE archived_at IS NULL
   AND model LIKE 'codex:%'
```

Один тост на провайдера вместо четырнадцати. Агенты на других провайдерах не
трогаются вообще — `kimi-coding:` продолжает работать.

### 3.3 Пробуждение

Используем существующий механизм фоновых задач (`jobs`), ничего нового:

```ts
await ctx.fns.jobs.schedule({
  agentId: id,
  runner: "at",
  nextAt: resetsAt + jitter,      // jitter: 60_000 + hash(id) % 240_000
  prompt: `${provider} usage limit resets — continue the interrupted work`,
  spec: { park: true },
})
```

Планировщик задач (`jobs.tickSchedule`) в нужный момент кладёт `prompt`
агенту сообщением и ставит его в очередь. Агент продолжает разговор сам.

**Джиттер обязателен.** Без него 14 агентов проснутся в одну и ту же секунду и
синхронно ударят в API. Разброс: `resetsAt + 60s + (hash(agentId) mod 4 мин)`.
Плюс 60 секунд — запас на расхождение часов и на неточность `resets_at`.

**Если лимит ещё не сброшен** — агент получит 429 снова и просто перепаркуется
на новый `resets_at`. Цикл самоисправляющийся и стоит ровно **один** запрос на
агента — но только при условии пункта 3.4.

Парковочный wake — отдельная задача; пользовательские `agent.wake` / `agent.cron`
не затираются. Id задачи хранится в `scratchpad.parked.wakeJobId`: повторный 429
отменяет прежнюю парковочную задачу вместо того, чтобы добавить вторую.

### 3.4 Никаких ретраев на лимит

`streamCodex.isRetryable` перестаёт ретраить, когда тело содержит
`usage_limit_reached` / `usage_not_included` / `quota_exceeded`. Обычный
`rate_limit_exceeded` (короткое окно, секунды) — ретраится как раньше.

`workerLoop`: регексп «transient» заменяется на явную проверку типа ошибки.
`usage_limit` никогда не транзиентный.

### 3.5 Ручное вмешательство не блокируется

`wake_at` не мешает `claimOne` — если человек напишет сообщение припаркованному
агенту, тот побежит и, скорее всего, снова упрётся в лимит. Это осознанное
действие пользователя, запрещать его не надо. Но ошибка при этом должна быть
человеческой строкой, а не сырым JSON.

## 4. Что появляется в коде

### 4.1 `src/llm/classifyError.ts` — новая функция

Единственное место, где сырой ответ провайдера превращается в решение.

```ts
ctx.fns.llm.classifyError({ provider, status, body, headers })
// →
{
  kind: 'usage_limit' | 'rate_limit' | 'transient' | 'auth' | 'overflow' | 'fatal',
  message: string,        // человеческая строка для UI
  resetsAt?: number,      // мс, когда квота вернётся
  retryAfterMs?: number,  // для kind='rate_limit'
  planType?: string,      // 'prolite', 'pro', 'max' …
  provider: string,
}
```

Источники сигнала:

| Провайдер | Что смотрим |
|---|---|
| `codex` | тело: `error.type == usage_limit_reached`, `error.resets_at` (сек), `error.resets_in_seconds`, `error.plan_type` |
| `anthropic`, `claude-code`, `anthropic-oauth` | `error.type == rate_limit_error`, заголовки `retry-after`, `anthropic-ratelimit-unified-5h/7d-reset` |
| `kimi-coding` | 429 + текст; `resetsAt` обычно нет → парковка на 1 час |
| прочие (`openai`, `groq`, `openrouter`) | 429 + `retry-after`; без `resets_at` считается `rate_limit`, а не `usage_limit` |

Если `resetsAt` неизвестен, но это явно исчерпанная квота — паркуем на
консервативный час и пишем это в reason честно («reset time unknown»).

### 4.2 `src/agent/parkOnUsageLimit.ts` — новая функция

```ts
ctx.fns.agent.parkOnUsageLimit({ info /* результат classifyError */, originAgentId?, fallbackMs?, now? })
```

Делает ровно четыре вещи:

1. находит всех незаархивированных агентов с тем же провайдером;
2. каждому пишет `scratchpad.parked` (через `session.mutateScratchpad`, не
   прямой мутацией):

   ```ts
   parked = {
     reason: 'usage_limit',
     provider: 'codex',
     account: 'default',
     model: 'codex:gpt-5.6-sol',
     planType: 'prolite',
     resetsAt: 1787219899000,
     wakeAt: 1787219999000,       // resetsAt + джиттер
     wakeJobId: 'job_…',          // задача jobs.schedule({ runner: "at" })
     parkedAt: Date.now(),
     message: 'Лимит подписки codex (prolite) исчерпан',
   }
   ```

3. планирует wake-задачу (`jobs.schedule`, `runner: "at"`) с джиттером и гасит `next_run_at`, `last_error`;
4. эмитит **один** тост (`ui.notify`) и по одному событию `parked` в транскрипт
   каждого агента (через `session.appendEvent`, рендерится карточкой
   `ui.chatEventCard`).

Возвращает `{ provider, resetsAt, parked: string[] }`.

### 4.3 `src/agent/unpark.ts` — новая функция

```ts
ctx.fns.agent.unpark({ id, reason?: 'model-switch' | 'manual' | 'wake', resume?, now? })
```

Снимает `scratchpad.parked`, отменяет ещё не сработавшую wake-задачу, ставит
`next_run_at = now`, если у агента есть непрочитанные сообщения. Вызывается из
`setModel`, из кнопки «Wake now» и (для чистки метки) из `jobs.tickSchedule`, когда срабатывает wake-задача.

### 4.4 `src/agent/setModel.ts` + `src/agent/$route_$id_model_POST.ts` — новое

Сейчас сменить модель у живого агента нельзя вообще — она задаётся только при
создании. Добавляем:

```ts
ctx.fns.agent.setModel({ id, model: 'kimi-coding:k3' })
```

- проверяет модель через `llm.resolveEndpoint` (провайдер существует, ключ
  есть) — иначе внятная ошибка, а не 500 на следующем запросе;
- `UPDATE agents SET model = ?`, обновляет живой объект в `ctx.state.agent[id]`;
- пишет событие `model_changed` в транскрипт (видимое, с «было → стало»);
- если агент был припаркован — вызывает `unpark`, и агент сразу продолжает
  работу на новой модели.

Роут `POST /agent/:id/model` принимает форму с полем `model` и опциональным
`scope=agent|provider` — второй вариант переводит **все** припаркованные агенты
этого провайдера разом (типичный случай: «переведи всех с codex на kimi»).

### 4.5 Правки существующих файлов

| Файл | Что меняется |
|---|---|
| `src/llm/streamCodex.ts` | `isRetryable` перестаёт ретраить `usage_limit_*`; текст ошибки строится через `classifyError` |
| `src/llm/streamAnthropic.ts` | сейчас `if (!res.ok) throw new Error(\`${provider} ${status}: ${text}\`)` — добавляется тот же разбор |
| `src/agent/workerLoop.ts` | вместо регекспа «transient» — `classifyError`; `usage_limit` → `parkOnUsageLimit`, без авто-ретрая |
| `src/agent/renderStatusBar.ts` | новая ветка перед `last_error`: если `scratchpad.parked` — жёлтый бейдж `parked · codex limit · resets Thu 10:58` |
| `src/ui/agentMetaPanel.ts` | секция Wake-up получает блок парковки с тремя действиями |
| `src/jobs/tickSchedule.ts` | при срабатывании парковочной wake-задачи снимает `scratchpad.parked` (`agent.unpark`) |

## 5. UI

### 5.1 Статусбар

Четвёртое состояние рядом с `running` / `queued` / `error` / `idle`:

```
parked · codex limit · resets Thu 10:58 (3d 16h)
```

Жёлтый (`text-warning`), с `title`, содержащим полный человеческий текст:
«Лимит подписки codex (план prolite) исчерпан. Квота вернётся 20 авг 10:58.
Агент проснётся сам». Красный красить нельзя — красный означает «сломалось,
почини», а тут чинить нечего.

### 5.2 Панель агента (`agentMetaPanel`)

Секция **Wake-up** уже существует и рисует обратный отсчёт (`ui.wakeTimer`,
тикает раз в секунду) плюс Cancel. Для припаркованного агента над ней
появляется блок:

```
┌─ Parked · usage limit ────────────────────┐
│ codex · prolite plan                      │
│ Quota resets Thu 20 Aug 10:58  (3d 16h)   │
│                                           │
│ [ Switch model ▾ ]  [ Switch account ▾ ]  │
│ [ Wake now ]        [ Cancel parking ]    │
└───────────────────────────────────────────┘
```

- **Switch model** — селект из `llm.listModels()`, сгруппированный по
  провайдеру; провайдеры без ключа показываются серым. Отправляет
  `POST /agent/:id/model`. Чекбокс «применить ко всем на codex».
- **Switch account** — короткий список моделей того же класса у другого
  провайдера: `codex:` → `openai:` (тот же GPT по API-ключу),
  `claude-code:`/`anthropic-oauth:` → `anthropic:`, `kimi-coding:` → `kimi:`.
  Это тот же `setModel`, просто с готовой подсказкой «то же семейство, но по
  ключу, за деньги».
- **Wake now** — `unpark({ reason: 'manual' })`. Честно предупреждает: если
  квота не вернулась, агент перепаркуется.
- **Cancel parking** — снимает метку и таймер, оставляя агента просто idle.

### 5.3 Транскрипт

Событие `parked` рендерится карточкой (`ui.chatEventCard`, тон warning):

> **Припаркован — лимит подписки**
> codex (prolite). Квота вернётся 20 авг 10:58 (через 3д 16ч).
> Проснусь сам и продолжу.

Событие `model_changed` — нейтральная карточка «codex:gpt-5.6-sol →
kimi-coding:k3».

### 5.4 Рейл

В списке агентов у припаркованных — жёлтая точка вместо серой, `title` с
временем сброса. Иначе непонятно, почему полтора десятка агентов молчат.

## 6. Данные

Новых таблиц и миграций **не требуется**. Всё раскладывается по существующим
колонкам:

| Где | Что |
|---|---|
| `agents.wake_at`, `agents.wake_reason` | момент и причина пробуждения |
| `agents.scratchpad.parked` | признак парковки и её детали (JSONB) |
| `agents.next_run_at` | `NULL` на время парковки |
| `agents.last_error` | `NULL` — парковка не ошибка |
| `agents.model` | меняется через `setModel` |
| `events` | `parked`, `model_changed`, существующий `wake_up` |

Живой объект агента (`ctx.state.agent[id]`) синхронизируется через
`session.syncAgentState` — прямых мутаций `agent.scratchpad` быть не должно.

## 7. Порядок работ

1. `llm/classifyError.ts` + тесты на реальных телах ошибок codex/anthropic.
2. `streamCodex` / `streamAnthropic` — перестать ретраить лимит.
3. `agent/parkOnUsageLimit.ts`, `agent/unpark.ts`.
4. `workerLoop` — развилка по `kind`.
5. `renderStatusBar` + `agentMetaPanel` + карточки событий.
6. `agent/setModel.ts` + роут + селекты в UI.
7. `llm/recordUsage.ts` + чтение заголовков в стримерах + кружки в левой
   панели (раздел 9).
8. Multi-account: `kind` у провайдера, третий сегмент в строке модели,
   миграция `oauth_credentials` на `(provider, account)`, ключ парковки
   `provider + account` (раздел 10).
9. (Позже) `llm.fallbackModel` и `llm.autoSwitchAccount` — автоматическая,
   а не ручная смена модели/аккаунта.

Пункты 1–6 закрывают заявленную задачу: агент паркуется, помечается в UI,
и пользователь может либо переключить модель, либо переключить подписку, либо
дождаться автоматического пробуждения. Пункт 7 убирает внезапность стены,
пункт 8 даёт запасной аккаунт.

## 8. Это касается только подписочных провайдеров

Важное разграничение, которое надо держать в голове по всему коду.

| Тип | Провайдеры у нас | Что значит 429 |
|---|---|---|
| **Подписка** (фиксированная квота на окно) | `codex`, `claude-code`, `anthropic-oauth`, `kimi-coding` | квота исчерпана, деньгами не решается, ждать до `resets_at` — **парковка** |
| **API-ключ** (оплата по факту) | `anthropic`, `openai`, `groq`, `openrouter`, `kimi` | троттлинг на секунды/минуты либо кончились деньги на счёте — **обычный ретрай** по `Retry-After` |
| **Локальный** | `lmstudio`, `mock` | лимитов нет вообще |

Поэтому в `resolveEndpoint.PROVIDERS` добавляется поле `kind: 'subscription' | 'api' | 'local'`.
Парковка (`parkOnUsageLimit`) применяется **только** к `kind === 'subscription'`.
Для `api` 429 остаётся транзиентным: ретрай с бэкоффом, как сейчас. Исключение —
явный `insufficient_quota` / `billing_hard_limit_reached` у OpenAI: денег нет,
ретраи бесполезны, это `kind: 'fatal'` с внятным текстом «пополните счёт», без
таймера пробуждения (сервер не говорит, когда).

Следствие для UI: индикатор остатка квоты (раздел 9) рисуется только для
подписочных провайдеров. У API-ключа нет «остатка» — у него есть счёт.

## 9. Индикатор квоты в левой панели

Сейчас про исчерпание узнаёшь по факту удара в стену. Провайдеры сообщают
остаток на **каждом успешном** ответе — надо просто его читать.

### 9.1 Откуда берутся числа

| Провайдер | Источник |
|---|---|
| `claude-code`, `anthropic-oauth` | заголовки ответа `anthropic-ratelimit-unified-5h-utilization` / `-5h-reset` и `-7d-utilization` / `-7d-reset` (доля 0..1 и unix-секунды) |
| `codex` | заголовок `x-codex-primary-used-percent` (0..100) + SSE-событие с `rate_limits`: `primary`/`secondary` → `{ used_percent, window_minutes, resets_at }` |
| `kimi-coding` | ничего не отдаёт — показываем только «last error / parked», без шкалы |

Это ровно то, что делают claude-code (`claudeAiLimits.ts`, `extractRawUtilization`)
и codex-rs (`RateLimitSnapshot` с `primary`/`secondary` окнами, где
`used_percent`, `window_minutes`, `resets_at`).

### 9.2 Где хранится

Новая таблица не нужна — снимок кладётся в `kv` под ключом
`llm:usage:<provider>[:<accountId>]`:

```ts
{
  provider: 'codex',
  accountId: 'acct_…',            // см. раздел 10
  windows: {
    primary:   { usedPercent: 78.4, windowMinutes: 300,   resetsAt: 1787219899000 },
    secondary: { usedPercent: 41.0, windowMinutes: 10080, resetsAt: 1787651899000 },
  },
  planType: 'prolite',
  updatedAt: 1786900542324,
  source: 'headers' | 'stream' | 'error',
}
```

Пишется одной функцией `llm.recordUsage({ provider, account?, headers?, rateLimits?, spent?, resetsAt?, planType?, now? })`,
вызываемой из `streamAnthropic` / `streamCodex` после успешного ответа —
и, дополнительно, из `classifyError`, когда прилетел 429 (тогда
`usedPercent = 100`, `resetsAt` из тела ошибки).

### 9.3 Как выглядит

В левой панели, над списком агентов — по одному кружку на подключённый
подписочный аккаунт:

```
◔ codex        78%   resets in 2h 14m
◕ claude-code  41%   resets in 3d
○ kimi-coding   —    no data
```

- **кружок с заполнением** — SVG `stroke-dasharray` на окружности, заполнение
  равно `usedPercent`; внутри — логотип провайдера (`ui.modelLogo` уже есть);
- **цвет**: до 60% — нейтральный `base-content/45`; 60–85% — `warning`;
  85–100% — `error`; при 100% кружок полный и рядом появляется значок паузы —
  это состояние «припаркованы»;
- показывается **худшее** из двух окон (5h/7d): бессмысленно рисовать 12%
  недельного, когда пятичасовое на 96%;
- `title` — полный текст: «codex · prolite · 5h: 78% (сброс 12:40) · 7d: 41%
  (сброс 20 авг)»;
- клик — раскрывает обе шкалы и кнопки «Switch model» / «Switch account» для
  всех агентов на этом провайдере разом.

Фрагмент отдаётся отдельным роутом `GET /llms/usage` и обновляется тем же
механизмом, что и остальная панель (htmx, интервал ~30с плюс событие после
каждого ответа LLM). Данные читаются из `kv`, никаких запросов к провайдеру
ради индикатора не делается — только то, что уже прилетело попутно.

### 9.4 Предупреждение до стены

При переходе через 85% — один тост на провайдера (не на агента):
«codex: использовано 87% пятичасового окна, сброс в 12:40». Повторно тот же
порог не тостится, пока окно не сбросится (флаг в том же `kv`-снимке).

## 10. Несколько аккаунтов у одного провайдера

Сценарий: два ChatGPT-аккаунта для `codex:` или два Claude-аккаунта. Сейчас
это невозможно — `codex:` жёстко читает `~/.codex/auth.json`, `claude-code:` —
одну запись в keychain. Ни один из трёх референсов multi-account не умеет:
у pi-mono `auth.json` — это `Record<providerId, AuthCredential>`, один
кредентал на провайдер; у codex и claude-code — один файл/keychain-запись.
Значит проектируем сами.

### 10.1 Модель

Вводится понятие **account** — именованный набор учётных данных внутри
провайдера:

```
provider = codex
accounts = [
  { id: 'work',     source: 'file:~/.codex/auth.json',        label: 'work@…',    accountId: 'acct_A' },
  { id: 'personal', source: 'file:~/.codex/auth.personal.json', label: 'me@…',    accountId: 'acct_B' },
]
```

Модель агента получает необязательный третий сегмент:
`provider:modelId` (аккаунт по умолчанию) или `provider/account:modelId`,
например `codex/personal:gpt-5.6-sol`. Старая форма продолжает работать —
это аккаунт `default`.

`llm.resolveEndpoint` разбирает третий сегмент и возвращает `accountId`
вместе с ключом. Всё остальное — заголовки, refresh — уже параметризовано
токеном, менять не нужно.

### 10.2 Хранение

Таблица `oauth_credentials` уже существует, но её PK — `provider`. Миграция
меняет ключ на `(provider, account)` с `account = 'default'` для
существующих строк. Файловые источники (`~/.codex/auth.json`) описываются
настройкой `llm.accounts` — список `{ provider, account, source, label }`.

### 10.3 Что меняется в парковке

Ключ квоты становится `provider + account`, а не просто `provider`:

- `parkOnUsageLimit` паркует агентов, у которых **и провайдер, и аккаунт**
  совпали. Агенты на `codex/personal` продолжают работать, когда исчерпан
  `codex/work`;
- снимок использования в `kv` — `llm:usage:codex:work`;
- в левой панели — по кружку на аккаунт, с меткой (`codex · work`).

### 10.4 Переключение аккаунта

Кнопка **Switch account** на припаркованном агенте получает точный смысл:
список аккаунтов того же провайдера с их остатком квоты, свободные —
сверху, исчерпанные — серым с временем сброса.

```
Switch account
  ◔ codex · personal   32% used            [ Use ]
  ● codex · work      100% · resets 10:58  (parked)
  ○ openai (API key)   pay per token       [ Use ]
```

Выбор вызывает тот же `agent.setModel({ id, model: 'codex/personal:gpt-5.6-sol' })`
с чекбоксом «применить ко всем припаркованным на codex/work». То есть
переключение аккаунта — частный случай смены модели, отдельного механизма
не заводим.

### 10.5 Автоматический перелив (позже)

Если у провайдера есть второй аккаунт со свободной квотой, парковка может
сразу предлагать (а при opt-in настройке `llm.autoSwitchAccount` — сразу
делать) перевод туда, и ставить `wakeAt` на возврат обратно после сброса
основного. Делать это по умолчанию нельзя: пользователь может сознательно
держать второй аккаунт про запас.

## 11. Открытые вопросы

- **Стоит ли делать multi-account сразу?** Раздел 10 описывает целевую схему,
  но она тянет миграцию `oauth_credentials` и новый формат строки модели.
  Можно сделать пункты 1–6 с ключом `provider` и заменить его на
  `provider + account` отдельным шагом — места, где это важно, перечислены
  в 10.3.
- **Нужен ли `fallbackModel` по умолчанию?** Автоматический перевод 14 агентов
  на другую модель без спроса может быть неприятным сюрпризом (другая цена,
  другое качество). Предлагается opt-in настройка, а не поведение по умолчанию.
- **Что делать с делегированными детьми?** Ребёнок в команде, упёршийся в
  лимит, паркуется вместе со всеми; родитель узнаёт об этом из
  `agent.team({ agent })`. Возможно, стоит уведомлять родителя явно.
- **Лимит длиннее недели.** `wake_at` в UI-форме ограничен 7 сутками; сама
  функция `wakeAt` — нет. Если провайдер скажет «сброс через 10 дней», парковка
  сработает, но отредактировать её через форму будет нельзя.
