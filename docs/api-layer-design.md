# Общий API-слой: операции плагина для других сред

**Статус:** черновик для обсуждения. Ничего не реализовано, решения не приняты. Опирается на [api-groups-design.md](api-groups-design.md) и уточняет его для одного случая: плагин отдаёт узкие операции другой среде Hyper или сервису. Первый потребитель и источник примеров — плагин `gws` (шлюз в Google Workspace, клиент — среда `crm`). Связанные документы: [auth.md](auth.md), [hyper-node.md](hyper-node.md), [function-tags.md](function-tags.md).

Все описанные ниже проверки, таблицы, команды и настройки нового API-слоя — **предложение, не существующая реализация**. Упоминания текущего кода отмечены отдельно; этот документ сам по себе не добавляет защиту.

## Резюме на одну страницу

**Зачем.** Плагин `gws` сам написал всё, что нужно любому плагину с внешним API: клиентов с токенами, правила доступа, журнал с цепочкой хешей, проверку админа, HTTP-маршруты. Это около 350 строк плюс большая часть страницы админа (ещё 186) из 1500 строк плагина без тестов, и в них нет ничего про Google. В ядре то же самое уже есть второй раз, в урезанном виде: `node.issueClient` / `node.authorize` для раздачи моделей. Третий плагин напишет это в третий раз и ошибётся в другом месте.

**Что предлагаем.** Модуль ядра `api`. Плагин пишет только свои операции, остальное общее:

1. **Операция — обычная функция с тегом.** `@api read|write` и `@resource <параметр>`. Имя операции = имя функции в пространстве плагина (`src/gws/mail/get.ts` → `mail.get`). Схема входа берётся из существующего `paramsSchema`; `returnType` сейчас содержит строку TypeScript, а не JSON Schema ответа. **TODO:** спроектировать генерацию выходной JSON Schema, включая разрешение именованных типов и `Promise`. Группу объявляет один файл `$apigroup.ts`.
2. **Клиент и токен.** Одна таблица `api_credentials`: в базе только sha256, токен `hy_svc_…` показывается один раз, у него есть срок, ротация идёт с перекрытием (старый и новый живут вместе сутки), отзыв действует сразу.
3. **Правило.** Таблица `api_rules`: кто × какие операции × какие ресурсы × ограничения плагина × срок. По умолчанию запрещено. У правила есть номер версии, в журнале пишется `правило@версия`.
4. **Журнал.** Таблица `api_audit`, общая для всех плагинов: только дописывание (триггер), цепочка sha256 на каждую группу. Пишется каждый вызов, каждый отказ и каждое изменение правил и клиентов. Содержимое не пишется никогда.
5. **HTTP.** `POST /api/<группа>/v1/call {op, args}`, `GET …/status`, `GET …/ops`, админские `…/admin/{rules,clients,audit}`. Один формат ошибок, лимиты, `Idempotency-Key` для операций записи.
6. **Кто админ.** Клиентский токен не админ никогда. Человек, которого просто «пропустил хаб», тоже не админ. Админ — это человек в браузере плюс подтверждение, которое скрипт сделать не может (passkey), либо отдельный короткий админ-токен, выпущенный на самой машине среды.

**Дыра, которую это закрывает (нашёл Михаил).** На Mac Studio все среды выходят в сеть как устройство niquola. Хаб честно подписывает «это niquola», и `gws` видит запрос от `crm` без токена как `user:niquola@…`, то есть как админа. `crm` может сам поменять себе правила и выпустить токен. В новом слое подпись хаба прав админа не даёт.

**Чего слой сам не закрывает.** По коду видно, что дыра шире админских маршрутов: тот же «niquola из любой среды» может открыть обычный интерфейс Hyper `gws` и вызвать через `/rpc` любую функцию, включая `gws.policyPut` (в `/rpc` нет проверки роли, CSRF-токен для входа через хаб отдаётся страницей). Запросом я это не проверял — среды трогать было нельзя. Закрывается это только раздельной сетевой личностью сред (предложение `automation-identity` в hypermesh) и шагом 3 из api-groups («`/rpc` для member — только `@api`/`@view`»). API-слой без этих двух шагов закрывает одну дверь из двух.

**Что остаётся в gws.** Только Google и фильтры: ключ сервисного аккаунта, запросы к Gmail/Calendar/Directory, тела операций, классификация и фильтр писем, список ящиков по группам. `crm` при переезде не останавливается: тот же адрес, то же тело запроса, тот же токен (в новую таблицу переносится его хеш).

**Что с `node.*`.** Объединяем, как уже записано в api-groups: `llm_node_clients` переезжает в `api_credentials`, `node.authorize` становится `api.authorize` плюс проверка числа пересылок, список провайдеров клиента становится правилом.

**Что беру из api-groups и что меняю** — §2. Главные отличия: права лежат не в токене, а в отдельных версионируемых правилах; журнал — цепочка, а не простой лог; подпись хаба не даёт админа.

## 1. Что общее, а что про Google

Прочитано: `~gws/dev/gws-repo` (коммит `4651ce6`), в ядре `src/node`, `src/auth`, `src/project/canCall.ts`, `src/rpc`.

| Часть gws | Файлы | Общее или Google |
|---|---|---|
| Кто зовёт | `caller.ts` | общее. Bearer `gws_…` → `client:<имя>`, иначе `user:<email>` из входа Hyper |
| Клиенты и токены | `issueClient`, `revokeClient`, `clients` | общее. 32 случайных байта, в базе sha256 и подсказка |
| Правила | `Policy.ts`, `policies`, `policyPut`, `policyRemove`, `policyFind` | каркас общий (клиент, операции, ресурсы, срок, запрет по умолчанию). Поля `filter`, `formats`, `internalDomains` и запись `group:<email>` в ящиках — Google |
| Журнал | `audit`, `auditVerify`, `auditList`, `canon` | общее целиком |
| Админ | `isAdmin`, `$setting_admins` | общее |
| HTTP | `http.ts` и 10 файлов `$route_` | общее |
| Диспетчер | `call.ts` | общее: проверить имя, найти правило, записать в журнал, поймать ошибку. Google здесь только подсчёт «сколько вернули, сколько скрыли» |
| Операции | `op.ts`, `gmail`, `googleGet`, `googleToken`, `members`, `mailboxesFor`, `trimEvent` | Google |
| Фильтры | `classify`, `decide`, `judge`, `knownSenders*`, `correspondents*`, `isKnown`, `filterOp` | Google и CRM |
| Страница админа | `admin.ts` | списки клиентов, правил и журнала общие; блок фильтров — Google |

Что уже есть в ядре:

| В ядре | Что делает | Чего не хватает |
|---|---|---|
| `node.issueClient` / `clients` / `revokeClient` | токен клиента, sha256 в `llm_node_clients`, список провайдеров | срока, ротации, автора, журнала; правил кроме списка провайдеров |
| `node.authorize` | проверка сети (loopback, tailnet, hypermesh), лимит пересылок, bearer → клиент | то же; проверка сети скопирована ещё в четырёх местах |
| `auth.currentUser`, `auth.portalIdentity` | вход людей: cookie, OIDC, подпись хаба `X-Hn-Assertion`. Возвращает и `device` из подписи | использования `device` в решениях о доступе я не нашёл |
| `project.canCall` | закрывает только функции уровней `user_/project_/agent_` | системные функции открыты любому вошедшему |
| `POST /rpc` | CSRF и `canCall` | ролей нет: любой member зовёт любую функцию плагина |

Слабые места самого gws, которые общий слой исправит заодно:

- токен без bearer от «niquola» — это админ (дыра из резюме);
- bearer работает только поверх вошедшего человека: без подписи хаба `caller` возвращает `null`;
- перевыпуск токена сразу убивает старый, срока у токена нет;
- список операций повторён в трёх файлах и уже разошёлся (в `Policy.ts` нет `filter.*`);
- у правила нет версии;
- журнал берёт `LOCK TABLE … EXCLUSIVE` на каждый вызов, то есть все вызовы идут по одному;
- в журнал пишется строка поиска `q`, а в ней может быть содержимое;
- лимитов нет.

## 2. Что беру из api-groups и что меняю

**Беру без изменений:** всё внешнее под `/api`; группа = плагин, имя выводится из имени плагина; файл `$apigroup.ts`; тег `@api <verb>` на функции; под `/api` только токен, без cookie; одна функция `api.authorize`; таблица `api_credentials` с sha256 и префиксом `hy_<kind>_`; `http.peer` вместо пяти копий проверки сети; discovery и OpenAPI из `paramsSchema`; лимиты token bucket; миграция с этапом «только пишем, не запрещаем»; переезд `node` в группу `llm`.

**Меняю или добавляю:**

| № | В api-groups | Здесь | Почему |
|---|---|---|---|
| 1 | права (`grants`) лежат в строке токена | отдельная таблица `api_rules` с версией | правило меняется без перевыпуска токена; одно правило для токена и для workload-личности; в журнале видно, по какой версии правила пустили |
| 2 | право — scope `<group>:<verb>` | правило перечисляет операции по именам; `*` покрывает только `read` | в gws расширение доступа — решение админа; новая операция не должна открываться сама |
| 3 | ресурс у функции не описан | тег `@resource <параметр>` и виды ресурсов в группе | ядро само сверяет «этот ящик разрешён», плагин не пишет проверку |
| 4 | — | `constraints` в правиле: ограничения плагина по его схеме | фильтр и форматы gws не знает никто, кроме gws |
| 5 | `api_audit` — простой лог | только дописывание, цепочка хешей, события админа и отказы | требование gws; для шумных групп остаётся режим простого лога |
| 6 | подпись хаба = человек, права по роли | подпись хаба не даёт админа; рядом с bearer это только пометка «через кого» | дыра Михаила |
| 7 | «клиент не сильнее своего человека» | для сервисных клиентов верхняя граница — правило, утверждённое админом группы | `crm` читает ящики всей команды, чего человек-владелец токена сам не может |
| 8 | путь на каждую функцию | плюс `POST …/call {op, args}`; админские маршруты в каждой группе | `crm` уже так зовёт; один адрес проще для клиента |
| 9 | — | ротация с перекрытием, обязательный срок сервисного токена, `Idempotency-Key`, коды ошибок | §5, §8 |
| 10 | токены control plane упомянуты | личность `workload` (SPIFFE) привязана к тому же имени клиента | переход с токена на workload не трогает правила |

## 3. Как плагин объявляет операции

Новой грамматики две вещи: файл `$apigroup.ts` (он уже предложен в api-groups) и тег `@resource`. Теги объявляются файлами `$tag_<имя>.ts`, как сейчас `@view` и `@live`: `src/api/$tag_api.ts` и `src/api/$tag_resource.ts`.

**Группа** — один файл в корне пространства плагина:

```ts
// gws/src/gws/$apigroup.ts
export default {
    title: "Google Workspace gateway",
    description: "Read-only mail, calendar and directory of the team, filtered for the CRM.",
    versions: { v1: { status: "stable" } },
    network: "private",                    // any | private | loopback
    credentials: ["service", "workload"],  // кому вообще можно сюда
    audit: "chain",                        // chain — цепочка хешей; log — простой лог
    admins: "gws.admins",                  // настройка со списком email
    resources: {
        mailbox: { normalize: "lower", resolve: { group: "gws.members" } },  // запись "group:sales@…" раскрывает gws.members
        group:   { normalize: "lower" },
    },
    constraints: {                         // JSON Schema ограничений правила
        type: "object", additionalProperties: false,
        properties: {
            filter:          { enum: ["external", "layered", "none"], default: "external" },
            formats:         { type: "array", items: { enum: ["metadata", "full"] }, default: ["metadata"] },
            internalDomains: { type: "array", items: { type: "string" } },
        },
    },
    auditArgs: ["id", "threadId", "messageId", "rfcId", "since", "format", "timeMin", "timeMax"],
    limits: { rpm: 300, bodyBytes: 65_536, resultBytes: 30_000_000, timeoutMs: 60_000 },
} satisfies types.api.Group;
```

**Операция** — обычная функция, один файл. Пример схематичный, вызовы внутри условные:

```ts
// gws/src/gws/mail/get.ts   →   ctx.fns.gws.mail.get   →   операция "mail.get"
/**
 * Reads one message of a mailbox. Bodies need the rule format 'full'.
 * @api read
 * @resource mailbox
 * @param opts.mailbox Mailbox address.
 * @param opts.id Gmail message id.
 * @param opts.format What to return. @default "metadata"
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Mailbox address. */ mailbox: string;
    /** Gmail message id. */ id: string;
    /** What to return. */ format?: "metadata" | "full";
}): Promise<types.gws.Message | { id: string; withheld: string }> {
    const { rule } = ctx.fns.api.current({});           // кто зовёт и по какому правилу; вне вызова API — ошибка
    const format = opts.format ?? "metadata";
    if (!rule.constraints.formats.includes(format)) throw ctx.fns.api.error({ code: "forbidden", message: `format ${format} is not allowed by the rule` });
    const message = await ctx.fns.gws.gmail({ mailbox: opts.mailbox, path: `messages/${opts.id}`, query: { format } });
    const verdict = await ctx.fns.gws.decide({ message, rule });
    ctx.fns.api.note({ data: { withheld: verdict.pass ? undefined : verdict.reason } });   // в журнал: счётчики и причины, не содержимое
    return verdict.pass ? message : { id: opts.id, withheld: verdict.reason };
}
```

Что здесь делает ядро, а не плагин:

- **Имя.** `mail.get` — путь функции внутри пространства плагина. Отдельного списка операций нет, расходиться нечему. В ядре вложенные пространства работают (`src/procs/db/select.ts` → `procs.db.select`); плагинов с вложенными папками я не нашёл, это нужно проверить. Запасной вариант — имя в теге: `@api read mail.get` на функции `gws.mailGet`.
- **Схема.** В предлагаемом слое аргументы сверяются с `paramsSchema` до вызова, лишние поля отклоняются (`400 bad_args`). Она же идёт в `GET …/ops` и в OpenAPI. Текущий `returnType` — только текст TypeScript; полноценная схема ответа для discovery/OpenAPI требует отдельной генерации (TODO), её пока нет.
- **Ресурс.** `@resource mailbox` значит: значение параметра `mailbox` — ресурс вида `mailbox`, и правило должно его разрешать. Тег можно повторять. Операция без `@resource` (например `mailboxes.list`, «что мне разрешено») получает все свои правила через `ctx.fns.api.rulesFor({})`.
- **Класс.** `read` или `write`. Запись не покрывается звёздочкой в правиле и требует `Idempotency-Key`.
- **Журнал.** Ядро само пишет операцию, ресурсы, правило, статус, время и аргументы из `auditArgs`. Плагин добавляет только счётчики через `api.note`.

Функция без `@api` снаружи не видна. Функция с `@api` в плагине без `$apigroup.ts` не загружается, `code.quality` сообщает `api-undeclared` (как в api-groups).

## 4. Кто зовёт: клиент, человек, workload, админ

Вызывающий (`principal`) бывает четырёх видов:

| Вид | Как доказывает | Запись | Может быть админом |
|---|---|---|---|
| клиент | `Authorization: Bearer hy_svc_…` | `client:crm` | нет, никогда |
| workload | подписанный токен control plane, `sub` = SPIFFE-идентификатор среды | тоже `client:crm` (по привязке в `api_credentials.subject`) | нет |
| человек | cookie этого Hyper или подпись хаба — только для интерфейса, не `/api` | `user:anna@…` | только в интерфейсе и только с подтверждением |
| админ-токен | `Authorization: Bearer hy_adm_…` | `admin:niquola@…` | да, это его единственное право |

Правила разбора, по порядку:

1. Есть bearer — вызывающий определяется **только** по нему. Человек из подписи хаба пишется в журнал как `via` («через чьё устройство пришло») и на права не влияет. Неизвестный или отозванный токен — `401`, без отката на «человека».
2. Под `/api`, включая `call`, без bearer предлагается возвращать `401`: cookie и подпись хаба не заменяют токен. Человек работает через интерфейс, а не через bearer-less `/api/call`. Правила `user:<email>` для прямого вызова операций и настройка `api.userRules` остаются открытым вопросом (§12), не реализованной защитой и не исключением из token-only.
3. Клиентский и workload-токен на админских маршрутах — всегда `403`, проверка стоит до чтения списка админов.
4. Админ-токен не проходит на `call`: тот, кто правит правила, сам данные не читает.

**Подтверждение человека.** Вход через хаб на Mac Studio не доказывает, что у клавиатуры человек: хаб узнаёт устройство, а устройство общее для всех сред. Поэтому нужен фактор, которого у скрипта в чужой среде нет. Два этапа:

- **Предлагаемый этап 1: админ-токен (ещё не реализован).** Предлагаемая команда `hyper api admin-token --group gws --for niquola@… --ttl 8h` запускается на машине среды её пользователем ОС. Токен показывается один раз, живёт не дольше суток, каждое применение пишется в журнал. По HTTP админ-токен не выпускается.
- **Этап 2: passkey.** Это путь интерфейса, а не `/api` (под `/api` остаются только токены, как в api-groups). На странице `api.admin` человек из списка админов нажимает «подтвердить» → `POST /auth/confirm` → WebAuthn с присутствием человека → билет на 10 минут, привязанный к его сессии и группе. С билетом страница зовёт `api.rulePut` и остальные админские функции. В ядре passkey сейчас нет (`auth.passkey*` нужно написать).

Проверка живёт в функции, а не только в маршруте: `api.rulePut`, `api.issueClient` и остальные админские функции сами зовут `api.requireAdmin({ group })`. Иначе их можно позвать через `/rpc` или попросить агента среды — так сейчас обходится `gws.isAdmin`. Локальный REPL среды (loopback, JWT из файла пользователя ОС) считается админом: это тот же уровень доверия, что запуск команды на машине.

**Клиенты и токены.**

```sql
CREATE TABLE api_credentials (
    id            TEXT PRIMARY KEY,           -- cred_…
    grp           TEXT NOT NULL,              -- группа, для которой выпущен; '*' — весь экземпляр (выпускает только owner)
    kind          TEXT NOT NULL,              -- service | workload | admin | pat | device | node | harness
    name          TEXT NOT NULL,              -- имя клиента: crm → client:crm. Не уникально: при ротации строк две
    owner_user_id TEXT,                       -- человек, который отвечает за клиента
    token_hash    TEXT UNIQUE,                -- sha256 токена; NULL у workload
    token_hint    TEXT,                       -- hy_svc_ab…wxyz для списка
    subject       TEXT,                       -- workload: spiffe://…; NULL у токенов
    network       TEXT NOT NULL DEFAULT 'private',
    expires_at    BIGINT,                     -- у service обязателен, по умолчанию 90 дней
    revoked_at    BIGINT,
    created_at    BIGINT NOT NULL,
    created_by    TEXT NOT NULL,
    last_used_at  BIGINT,
    last_used_via TEXT,
    use_count     BIGINT NOT NULL DEFAULT 0
);
```

- **Выпуск:** `api.issueClient({ group, name, expiresInDays?, note? })` → `{ id, name, token }`. Токен — `hy_svc_` плюс 32 случайных байта, в базе sha256. Быстрого хеша достаточно: токен случайный, подбирать нечего.
- **Ротация:** `api.rotateClient({ group, name, overlapHours = 24 })` выпускает второй токен, старому ставит срок «сейчас + перекрытие». Клиент меняет секрет без простоя.
- **Срок:** `GET …/status` показывает клиенту `expiresInDays`; за 14 дней до конца событие `client.expiring` уходит админам.
- **Отзыв:** `api.revokeClient({ group, name | id })`, действует со следующего запроса (кэш сбрасывается).
- **Workload:** строка `kind = workload`, `subject = spiffe://hn/<команда>/<узел>/<среда>`, без секрета. Токен control plane проверяет `auth.verifyIdToken` по JWKS, `aud` = адрес этого Hyper. Имя клиента то же, правила не меняются. Работает только когда у каждой среды своя личность в сети.

## 5. Правила доступа

```sql
CREATE TABLE api_rules (
    id          TEXT PRIMARY KEY,
    grp         TEXT NOT NULL,
    version     INT  NOT NULL,              -- +1 при каждом изменении
    principal   TEXT NOT NULL,              -- client:crm | user:a@b.io ; '*' — любая строка символов
    ops         JSONB NOT NULL,             -- ["mail.get", "mail.thread", "calendar.*"]
    resources   JSONB NOT NULL,             -- { "mailbox": ["*@health-samurai.io", "group:sales@…"], "group": ["sales@…"] }
    constraints JSONB NOT NULL DEFAULT '{}',-- по схеме группы; у gws { filter, formats, internalDomains }
    limits      JSONB,                      -- { rpm, perDay } — только ужесточают лимиты группы
    note        TEXT NOT NULL DEFAULT '',
    expires_at  BIGINT,
    disabled_at BIGINT,
    created_by  TEXT NOT NULL, created_at BIGINT NOT NULL,
    updated_by  TEXT NOT NULL, updated_at BIGINT NOT NULL
);
```

Как решается вызов (`api.ruleFind`):

1. Берём правила группы, которые не просрочены и не выключены, по порядку создания.
2. `principal` подходит по шаблону; операция есть в `ops`. Шаблон со звёздочкой (`mail.*`) покрывает только операции `read`; операцию `write` нужно назвать полностью.
3. Для каждого `@resource` операции значение аргумента должно подойти хотя бы под одну запись этого вида. Точное значение и `*` сверяет ядро. Запись вида `схема:значение` (`group:sales@…`) ядро отдаёт функции плагина из `resources.<вид>.resolve`; она возвращает список значений, ядро кэширует его на минуту.
4. Первое подошедшее правило выигрывает. Ничего не подошло — `403` и запись `call.denied`. Запрещающих правил нет.

Версии. `api.rulePut({ group, rule, ifVersion? })` проверяет поля, сверяет `constraints` со схемой группы, увеличивает `version` и пишет в журнал событие `rule.put` с полным новым телом. История правила — это журнал, отдельной таблицы версий нет. `ifVersion` защищает от двух одновременных правок (`409 conflict`). В каждой записи `call` стоит `rule: "<id>@<version>"`. `GET …/status` отдаёт клиенту `rulesVersion` — наибольшее `updated_at` его правил, чтобы клиент видел, что доступ изменился.

Пример правила для `crm`:

```json
{
  "principal": "client:crm",
  "ops": ["mail.profile", "mail.changes", "mail.list", "mail.get", "mail.thread", "mail.attachment", "calendar.events", "mailboxes.list"],
  "resources": { "mailbox": ["*@health-samurai.io"] },
  "constraints": { "filter": "layered", "formats": ["metadata", "full"], "internalDomains": ["health-samurai.io"] },
  "limits": { "rpm": 300 },
  "note": "CRM: внешняя переписка команды"
}
```

## 6. Журнал

```sql
CREATE TABLE api_audit (
    grp        TEXT   NOT NULL,
    seq        BIGINT NOT NULL,            -- 1, 2, 3 … внутри группы
    at         BIGINT NOT NULL,
    principal  TEXT   NOT NULL,            -- client:crm | user:… | admin:…
    via        JSONB,                      -- { person, device, net } из подписи хаба и http.peer; не доказано
    event      TEXT   NOT NULL,            -- call | call.denied | call.error | rule.put | rule.remove
                                           -- client.issue | client.rotate | client.revoke | admin.confirm | admin.denied | chain.start
    op         TEXT,
    rule       TEXT,                       -- <id>@<version>
    status     INT,
    ms         INT,
    data       JSONB  NOT NULL,            -- ресурсы, аргументы из auditArgs, счётчики из api.note, текст ошибки
    request_id TEXT,
    prev_hash  TEXT   NOT NULL,
    hash       TEXT   NOT NULL,            -- sha256(prev_hash + канонический JSON остальных полей)
    PRIMARY KEY (grp, seq)
);
-- триггер запрещает UPDATE, DELETE и TRUNCATE, как сейчас в gws.audit
```

- **Одна таблица, цепочка на группу.** Группы не мешают друг другу и проверяются по отдельности: `api.auditVerify({ group })`. Вместо `LOCK TABLE` — `pg_advisory_xact_lock` по имени группы, так что блокируется только своя цепочка.
- **Канонический JSON** — уже существующий `rpc.canonicalJson`, копия `gws.canon` не нужна.
- **Нет записи — нет ответа.** В режиме `chain` результат отдаётся клиенту только после записи в журнал.
- **Что не пишется:** токены, ключи, тела писем, произвольные аргументы. Только то, что группа перечислила в `auditArgs`, и то, что операция сама передала в `api.note`.
- **`401` в цепочку не пишется** (только в обычный лог): чужой с мусорным токеном не должен раздувать журнал.
- **Режим `log`** для шумных групп (`llm`): та же таблица, без цепочки, со сроком хранения.
- **Чтение:** `api.auditList({ group, principal?, before?, limit? })`, `api.auditHead({ group })`. Страница `api.admin` (`@view`, `@live api`) — общий вариант нынешней `gws.admin`: клиенты, правила, журнал, кнопка проверки цепочки.

Честное ограничение: цепочка в той же базе защищает от случайной и тихой правки, но не от того, кто владеет базой, — он снимет триггер и пересчитает хеши. Чтобы это было видно, голову цепочки (`seq`, `hash`) нужно раз в час отправлять наружу. Куда — открытый вопрос.

## 7. HTTP

Всё обслуживает один диспетчер ядра `api.http`; плагин маршрутов не пишет.

```
GET    /api/<группа>/v1/status                       кто я, срок токена, версия моих правил; секретов нет
GET    /api/<группа>/v1/ops                          операции, доступные мне, со схемами
POST   /api/<группа>/v1/call                         { op, args } → { ok, result }
POST   /api/<группа>/v1/<op>                         то же, форма из api-groups; GET для read

GET    /api/<группа>/v1/admin/rules                  только админ
PUT    /api/<группа>/v1/admin/rules                  { rule, ifVersion? }
DELETE /api/<группа>/v1/admin/rules/:id
GET    /api/<группа>/v1/admin/clients
POST   /api/<группа>/v1/admin/clients                { name, expiresInDays? } → токен один раз
POST   /api/<группа>/v1/admin/clients/:name/rotate   { overlapHours? } → новый токен один раз
DELETE /api/<группа>/v1/admin/clients/:name
GET    /api/<группа>/v1/admin/audit                  ?principal=&before=&limit=
GET    /api/<группа>/v1/admin/audit/verify
```

Админские маршруты под `/api` принимают только админ-токен. Человек с passkey работает через страницу `api.admin`, которая зовёт те же функции.

Имена `status`, `ops`, `call`, `admin`, `openapi.json` заняты; операцию с таким именем загрузчик не примет.

**Вызов с клиента.** По HTTP:

```
curl -sS https://hyper.gws.in.hn.hyper-mesh.xyz/api/gws/v1/call \
  -H "authorization: Bearer $GWS_TOKEN" -H "content-type: application/json" \
  -H "x-hyper-label: hypercrm.mailSync" \
  -d '{"op":"mail.get","args":{"mailbox":"anna@health-samurai.io","id":"18c2f0…"}}'

200 {"ok":true,"result":{…},"requestId":"req_01J…"}
403 {"ok":false,"code":"forbidden","error":"no rule allows client:crm mail.get on mailbox x@other.io","requestId":"req_01J…"}
```

Из другого Hyper — через общий клиент, устроенный как `node.add` и `llm_nodes`:

```ts
// один раз: где сервис и в каком секрете токен
await ctx.fns.api.remoteAdd({ name: "gws", url: "https://hyper.gws.in.hn.hyper-mesh.xyz/api/gws/v1", tokenRef: "secret://gws/crm-token" });

// вызов
const message = await ctx.fns.api.remoteCall({
    remote: "gws", op: "mail.get",
    args: { mailbox: "anna@health-samurai.io", id: "18c2f0…" },
    label: "hypercrm.mailSync",
});
```

`api.remoteCall` сам достаёт секрет, ставит заголовки, повторяет чтение при `429`, `502`, `504` и бросает ошибку с полем `code`.

**Ошибки.** Один формат, поле `error` остаётся строкой, как сейчас в gws, чтобы `crm` не ломался; добавляются `code` и `requestId`.

| Статус | `code` | Когда |
|---|---|---|
| 400 | `bad_args` | аргументы не прошли схему; в `details` — какие |
| 401 | `unauthenticated` | нет токена, токен неизвестен, отозван или просрочен |
| 403 | `forbidden` | нет правила; в тексте — операция и ресурс |
| 403 | `admin_required` | админский маршрут без админ-токена или подтверждения |
| 404 | `unknown_op` | такой операции нет или группа не видна этому токену |
| 409 | `conflict` | тот же `Idempotency-Key` с другими аргументами; правило изменили раньше |
| 413 | `too_large` | тело запроса или ответ больше лимита |
| 429 | `rate_limited` | с заголовком `retry-after` |
| 502 | `upstream` | ошибка внешней системы (у gws — Google) |
| 504 | `timeout` | операция не уложилась во время |
| 508 | `loop` | `x-hyper-hops >= 3` (текущий `node.authorize` отклоняет также нечисловое/нефинитное значение) |

**Лимиты.** Задаются в группе, правило может только ужесточить: размер тела (по умолчанию 256 КБ, как в `/rpc`), размер ответа, время (30 с), запросов в минуту на клиента (token bucket в памяти), запросов в сутки. Сеть проверяет `http.peer` против `network` группы и токена.

**Идемпотентность.** Нужна только операциям `write`: заголовок `Idempotency-Key` обязателен. Таблица `api_idempotency (grp, principal, key, args_hash, state, status, response, created_at, expires_at)`, срок 24 часа. Тот же ключ и те же аргументы — возвращается сохранённый ответ, операция второй раз не выполняется. Тот же ключ и другие аргументы, или операция ещё идёт — `409`. Чтение повторять безопасно, ключ не нужен.

**Заголовки.** `x-request-id` (свой или выданный ядром, пишется в журнал), `x-hyper-label` (пометка клиента «какая функция или агент зовёт»; заявлена, не доказана, на доступ не влияет), `x-hyper-hops`.

## 8. Функции модуля `api`

| Функция | Что делает |
|---|---|
| `api.http({ req })` | диспетчер всех `/api/<группа>/<версия>/*` |
| `api.authorize({ req, group, op, resources })` | кто зовёт, сеть, правило, лимиты → `{ ok, principal, rule }` или готовый отказ |
| `api.call({ group, op, args, principal, label? })` | проверить схему, найти правило, вызвать, записать в журнал. Только изнутри, через `/rpc` не вызывается |
| `api.current({})`, `api.rulesFor({})` | внутри операции: вызывающий и его правило; все его правила в группе |
| `api.note({ data })`, `api.error({ code, message })` | добавить счётчики в журнал; ошибка с кодом |
| `api.ops({ group })` | операции со схемами |
| `api.issueClient`, `api.rotateClient`, `api.revokeClient`, `api.clients` | клиенты и токены |
| `api.rulePut`, `api.ruleRemove`, `api.rules`, `api.ruleFind` | правила |
| `api.audit`, `api.auditList`, `api.auditVerify`, `api.auditHead` | журнал |
| `api.requireAdmin({ group })`, `api.adminToken({ group, for, ttlHours })` | проверка админа; выпуск админ-токена (только локально) |
| `api.remoteAdd`, `api.remotes`, `api.remoteRemove`, `api.remoteCall` | сторона клиента |
| `api.admin` | страница (`@view`, `@live api`) |

Таблицы: `api_credentials`, `api_rules`, `api_audit`, `api_idempotency`, `api_remotes`.

## 9. Как gws переезжает

Цель: `crm` не останавливается и ничего не меняет до последнего шага.

1. **Ядро.** Таблицы, функции, диспетчер, загрузчик `$apigroup.ts`, теги. gws пока работает по-старому.
2. **Объявление.** В gws появляется `$apigroup.ts`; `op.ts` режется на функции `gws.mail.get`, `gws.mail.changes`, `gws.calendar.events` и остальные с `@api read` и `@resource`. Тела переносятся как есть. Имена операций для клиента те же.
3. **Перенос данных** миграцией в gws:
   - `gws.clients` → `api_credentials`: тот же `token_hash`, `kind = service`, `grp = gws`. Старый токен `gws_…` продолжает работать, префикс принимается как унаследованный;
   - `gws.policies` → `api_rules`: `client` → `principal`, `mailboxes` → `resources.mailbox`, `groups` → `resources.group`, `filter`, `formats`, `internalDomains` → `constraints`, `version = 1`;
   - `gws.audit` остаётся архивом только для чтения. Первая запись новой цепочки — `chain.start` с головой старой (`hash`, число записей), так что цепочки связаны.
4. **Тень.** Отвечает старый `gws.call`, а `api.authorize` рядом считает своё решение и пишет расхождения. Неделя без расхождений — идём дальше. На это время правки правил пишутся в обе таблицы.
5. **Переключение.** Файл маршрута `/api/gws/v1/call` начинает звать `api.http`. Адрес, тело `{op, args}`, ответ `{ok, result}` и токен те же. Откат — вернуть в файле старую строку.
6. **Закрытие.** Старые админские пути `/api/gws/v1/{policies,clients,audit}` отвечают `410` со ссылкой на `…/admin/*`. Из gws удаляются `caller`, `isAdmin`, `issueClient`, `revokeClient`, `clients`, `Policy`, `policies`, `policyPut`, `policyRemove`, `policyFind`, `audit`, `auditVerify`, `auditList`, `canon`, `http`, `call`, десять файлов `$route_` и общая часть `admin.ts`.
7. **crm, когда удобно.** `api.rotateClient` с перекрытием сутки → новый токен `hy_svc_…` в секрет; `hypercrm.mail` переходит на `api.remoteCall`; `x-gws-label` → `x-hyper-label` (старый заголовок принимается).

**Что остаётся в gws:** ключ сервисного аккаунта и получение токена Google (`googleToken`, `googleGet`, `gmail`), тела операций, фильтры (`classify`, `classifyEvent`, `decide`, `judge`, `knownSenders*`, `correspondents*`, `isKnown`, `filterOp`), `members` (раскрытие `group:`), `mailboxesFor` (поверх `api.rulesFor`), `trimEvent`, настройки Google и блок фильтров на странице админа.

Открыт вопрос имени: по соглашению api-groups пользовательский плагин получает группу `x-gws` и путь `/api/x-gws/v1`. Тогда на шаге 5 старый путь `/api/gws/v1` остаётся алиасом, а `crm` меняет одну настройку `hypercrm.gwsUrl`.

## 10. Что делать с `node.*`

Объединять, по плану api-groups (§9–§11 там), с поправкой на правила:

- `llm_node_clients` → `api_credentials` (`kind = node`, `grp = llm`), хеши те же, старые токены работают;
- список `providers` клиента → правило `{ principal: "client:anna", ops: ["models", "chat", "responses", "messages"], resources: { provider: ["claude-code", "openai"] } }`;
- `node.authorize` → `api.authorize`; проверка сети уходит в `http.peer`, проверка пересылок остаётся в группе `llm`;
- `node.issueClient`, `node.clients`, `node.revokeClient` становятся тонкими обёртками над `api.*`, окна выдачи токена остаются как есть;
- журнал группы `llm` — режим `log`: вызовов много, промпты и так не пишутся;
- `/node/v1/*` остаётся алиасом `/api/llm/v1/*`, пока журнал показывает обращения по старому пути;
- `llm_nodes` (сторона клиента) пока не трогаем; `api_remotes` — то же самое в общем виде, сливать их или нет — открытый вопрос.

Порядок: сначала gws (он уже весь на этой модели и у него один клиент), потом `llm`.

## 11. Риски

1. **Вторая дверь остаётся открытой.** Пока среды на Mac Studio делят одно устройство, «niquola» из любой среды входит в обычный интерфейс `gws` и через `/rpc` или чат агента зовёт любые функции. Слой закрывает `/api` и ставит `api.requireAdmin` внутрь админских функций, но сам `gws.googleToken` или чтение секрета через `/rpc` он не закроет. Нужны оба шага: раздельная личность сред и запрет `/rpc` для функций без `@api`/`@view`.
2. **Root на машине.** У кого есть sudo на Mac Studio (в том числе агент с секретом `macstudio/sudo`), тот становится пользователем любой среды и выпускает себе админ-токен. Слой защищает от чужой среды и от сети, не от хозяина машины.
3. **Админ-токен — тоже токен.** Утечёт — будет админ. Поэтому короткий срок, выпуск только локально, запись каждого применения, запрет на `call`.
4. **Цепочку может переписать владелец базы.** Без внешней отметки головы журнал доказывает меньше, чем кажется.
5. **Отказ журнала останавливает API** в режиме `chain`. Это намеренно, но базу журнала нужно мониторить.
6. **Раскрытие `group:`** зовёт внешнюю систему при проверке правила. Кэш на минуту значит, что человек, убранный из группы, ещё минуту виден.
7. **Звёздочки в правилах.** `*@health-samurai.io` откроет и ящик, которого вчера не было. Это уже так в gws; слой это не меняет, только показывает в журнале.
8. **Переезд на общий слой — правка работающего шлюза к почте.** Отсюда этап тени и откат одной строкой.

## 12. Открытые вопросы

1. **Чем человек подтверждает, что он человек:** passkey в Hyper, проверка на хабе (как `check` для ssh), расширение Hyper approves, или на первом этапе хватит админ-токена?
2. **Раздельная личность сред на Mac Studio** (устройство вида `automation`, своя для `crm`, `gws`, агентов): кто делает и когда? Что делаем с интерфейсом `gws` до этого — выключаем в нём вход по подписи хаба, или оставляем и принимаем риск?
3. **Имя группы пользовательского плагина:** `x-gws` или `gws`? От этого зависит адрес для `crm`.
4. **Чтение правил и журнала админом** — тоже с подтверждением, или подтверждение нужно только для изменений?
5. **Правила на людей** (`user:<email>` зовёт операции напрямую): нужны ли вообще и через какой отдельный вход? В этом предложении `/api` остаётся token-only; bearer-less `call` и настройка `api.userRules` не реализованы.
6. **Журнал:** цепочка на группу или одна на экземпляр? Куда отправлять голову цепочки (хаб, control plane, hyper-git)? Сколько хранить и как архивировать, не ломая цепочку?
7. **Два человека на расширение доступа** (один предлагает правило, другой утверждает) — нужно ли для gws?
8. **Владелец сервисного клиента:** если пользователя-владельца отключили, токен сервиса гаснет или живёт дальше?
9. **Workload-личность:** готов ли control plane выдавать средам подписанные токены с SPIFFE-идентификатором, и хотим ли мы уйти с bearer-токенов совсем?
10. **Запрещающие правила и приоритеты** — предлагаю не делать; есть ли случай, где без них нельзя?
11. **`Idempotency-Key` для записи** — обязателен всегда или группа может его отключить?
12. **`llm_nodes` и `api_remotes`** — сливаем в одну таблицу или оставляем две?
13. **hyper-git:** `crm` пушит туда как niquola. Корень тот же, что в вопросе 2; в этот документ не входит, но решать вместе.
