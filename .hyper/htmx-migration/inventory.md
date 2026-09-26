# htmx 2 → 4: инвентаризация (commit a42f4ac)

Источники: `node_modules/htmx.org/dist/skills/htmx-upgrade-from-htmx2.md` (4.0.0-beta6),
официальный `dist/scripts/upgrade-check.py` (19 находок в 9 файлах), ручной grep.

Текущее состояние: `ui/layout.ts` грузит htmx 2.0.4 (`/ui/vendor/htmx.js`, unpkg);
`procs/ui/layout.ts` — пакет 4.0.0-beta6 (`/procs/ui/htmx.js`, уже с hx-sse и `htmx:after:process`).
В живом приложении активен ui/layout → реально работает htmx 2.

## 1. Переименование событий (JS)
| файл | было | станет | заметки |
|---|---|---|---|
| agent/$script_chat.js:65 | htmx:afterRequest | htmx:after:request | `detail.elt`→`detail.ctx.sourceElement`, `detail.successful`→`ctx.response.status<400` |
| agent/$script_chat.js:265 | htmx:beforeCleanupElement | htmx:before:cleanup | `detail.elt`→`event.target` |
| agent/$script_chat.js:272 | htmx:beforeSwap | htmx:before:swap | beforeSwap(): `detail.target/elt`→`ctx.target/ctx.sourceElement`; **OOB больше не отдельным событием** |
| agent/$script_chat.js:273 | htmx:afterSwap | htmx:after:swap | то же; afterSwap() читает target/elt |
| agent/$script_chat.js:152 | htmx.trigger(head,'load-older') | без изменений | |
| procs/events/client.js:155 | htmx:afterSwap | htmx:after:swap | только факт события |
| screen/client.js:214-220 | htmx:beforeRequest / afterSettle | before:request / after:swap | afterSettle больше нет |
| screen/client.js:784 | htmx:afterSettle | htmx:after:swap | |
| ui/$script_gap-count.js:11 | htmx:load | htmx:after:init (или after:process) | **after:init только на элементах с hx-запросом** — см. комментарий в procs/ui/$script_htmx.js; для «вставился фрагмент» нужен after:process |
| ui/$script_meta.js:31,78,80 | htmx:load | htmx:after:process | то же; `detail.elt` → `event.target` |
| ui/$script_popup.js:63 | htmx:afterSwap | htmx:after:swap | `detail.target`→`detail.ctx.target` |
| ui/$script_rpc.js:43 | htmx:responseError | htmx:response:error | `detail.xhr.status/responseText`→`ctx.response.status`/`ctx.text`; `detail.target`→`ctx.target` |
| ui/controlScript.ts:133 | htmx:afterRequest | htmx:after:request | `detail.successful` |
| ui/navMenu.ts:60 | htmx:afterSwap | htmx:after:swap | `detail.target` |
| agent/newForm.ts:11 | hx-on:htmx:before-swap | hx-on::before:swap | `event.detail.shouldSwap=false` → `event.preventDefault()` (или return false) |
| agent/renderEventHtml.ts:31, ui/chatComposer.ts:28, ui/chatColumn.ts:150, ui/agentMetaSection.ts:139 | hx-on::after-request | hx-on::after:request | внутри `event.detail.successful`/`detail.elt` — переписать |

## 2. JS API / расширения
- ui/$script_rpc.js:9 `htmx.defineExtension('popup-rpc', {init})` → `htmx.registerExtension`. Extension фактически только вешает click-обработчик в init — проще сделать обычным скриптом (без extension вообще).
- ui/layout.ts:277 `<body hx-ext="popup-rpc">` → удалить.
- htmx.ajax (screen/client.js:775, ui/$script_meta.js:73, ui/$script_rpc.js:80, news reader): сигнатура та же; в rpc/meta `values:` — в 4 `values` поддерживается (htmx.js:529) ✓. Нюанс: без `source` источником становится target — hx-атрибуты target влияют на запрос.
- htmx.trigger (navMenu, chatColumn, events.html, events/client.js) — без изменений.

## 3. Атрибуты
- plugins/flow/src/flow/card.ts:40,45 `hx-disabled-elt="find button"` → `hx-disable="find button"`.
- `hx-disable` (старый смысл) — не используется. `hx-vars/params/prompt/inherit/disinherit/history=false/hx-request=` — не используются.
- `hx-trigger` c `from:find input[type=search]` (procs/ui/filterBar.ts:30) — селектор с пробелом → `from:'find input[type=search]'`.
- `hx-trigger` c `queue:` — нет.
- `hx-delete` — не используется (п.11 гайда не касается).
- `data-hx-*` — нет.

## 4. Наследование (implicitInheritance)
Скрипт по тегам без собственного hx-запроса нашёл только 2 кандидата: procs/ui/toggle.ts:22 и procs/ui/form.ts:23 — оба на том же элементе, что и hx-post/hx-get, т.е. наследования нет.
`hx-boost` нигде не включён (только `hx-boost="false"` — станет безвредным). layout.test.ts уже проверяет, что обёртка #page-view не несёт hx-target/hx-swap/hx-push-url/hx-boost.
Риск: атрибуты, собранные строками в .ts, парсер мог пропустить → на шаге compat-off проверить в браузере (`document.querySelectorAll('[hx-target]:not([hx-get],[hx-post],[hx-popup])')`).

## 5. Ответы 4xx/5xx
140 мест `status: 4xx/5xx` в 40 route-файлах. В htmx 2 не вставлялись; в 4 — вставятся в target.
Первый этап: `noSwap: [204,304,'4xx','5xx']`. Потом — пройтись по роутам, вызываемым через hx-* (а не fetch/JSON), и решить: вернуть 204/HTML-ошибку для вставки или `hx-status:4xx="swap:none"`.
/rpc (400/504 JSON) + popup: обработчик ошибки уже есть в $script_rpc.js — с noSwap сохранится.

## 6. OOB
- procs/ui/respond.ts:36 — регионы по id, независимы от main → безопасно.
- agent/$route_dirs_status_GET.ts:28 — `<datalist hx-swap-oob>` независим.
- agent/$route_$id_events.html_GET.ts:53 — `#context-usage` outerHTML, независим от вставки сообщений.
Порядок (main теперь раньше OOB) — риска не видно. Можно позже перевести на `<hx-partial>`.

## 7. История / заголовки сервера
- toResponse.ts:41 `hx-history-restore-request` — в 4 заголовок тот же (`HX-History-Restore-Request`), restore делает GET в `[hx-history-elt]` с `select` → нужно, чтобы сервер отдавал **полную** страницу (он так и делает). Теперь это происходит на **каждый** Back (кэша нет) — в baseline Back брал снимок и сохранял 157 подгруженных сообщений; после — будет свежий рендер (70). Проверить скролл/позицию.
- toResponse.ts:38 `hx-select === '#frame'` — в htmx 4 заголовка HX-Select нет; в коде никто не запрашивает с select:#frame и x-hyper-frame (проверено grep) → мёртвая ветка, можно удалить или заменить на `HX-Request-Type: full`.
- `HX-Trigger` request header не читается сервером — ок. `HX-Target` теперь `tag#id` — сервером не читается (news like_POST сам шлёт `hx-target` во внутренний Request — не затронуто).
- Response `HX-Trigger` (204 + HX-Trigger в triggers/schedules/wake/pin, procs/ui/respond) — поддерживается. 204 + HX-Trigger в 4 обрабатывается в finally (htmx.js:647) ✓.
- Новый заголовок `HX-Request-Type: full|partial` — можно использовать вместо эвристик в toResponse.

## 8. Таймаут 60 с
/rpc сам режет на 30 с. Долгих hx-запросов не найдено, но для безопасности на первом этапе `defaultTimeout: 0`.

## 9. SSE
Свой EventSource в procs/events/client.js → htmx.trigger(el,'hyper-live') — не зависит от версии.
procs/ui/log.ts `hx-sse:connect` — уже синтаксис 4 (ext hx-sse), в ui/layout (htmx 2) сейчас не работает — после перехода заработает.

## 10. Прочее
- ui/$route_vendor_$name_GET.ts: убрать htmx.js 2.0.4 после переключения.
- В 4 нет `htmx:afterSettle` и классов htmx-settling/htmx-swapping/htmx-added — в нашем CSS/JS они не используются ✓.
- Morph-swap (`morphInner/morphOuter`) доступен из коробки — для шага improve.
- htmx-2-compat.js есть в пакете (старые имена событий параллельно новым) — **не используем**, события переименуем честно; флаги compat — только временно.
