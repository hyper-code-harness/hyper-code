# Remote browser для Hyper: обзор реализаций на GitHub

## Главный вывод

Это уже решённая задача, но есть два разных сценария: управлять отдельным Chrome на сервере через удалённый CDP и управлять повседневным Chrome пользователя через расширение. Для второго сценария самый близкий найденный пример — **Playwriter**: Chrome extension → локальный relay → удалённый клиент. Для первого полезны **OpenClaw** и **Browserless**. **Anomaly Browser Control** полезен как образец управления сессиями и восстановления связи.

Для Hyper рекомендую сохранить текущий API browser, добавить идентичность браузера и сменные подключения. Hypermesh использовать для защищённого доступа вместо собственного публичного туннельного сервиса. MCP для этого не обязателен: у нас уже есть процедурный API.

## Что проверено

Поиск GitHub repositories, README, документация и отдельные исходники relay. Проекты не устанавливались, тесты и совместимость с нашим plugin не проверялись. Описанное наличие функций не означает подтверждённую безопасность. Ссылки ведут на изменяемые ветки; это обзор, не аудит зафиксированных версий. Лицензии проверены по GitHub metadata и README, юридическое заключение не проводилось.

## Сравнение

| Проект | Что уже реализовано | Что полезно Hyper | Ограничение |
|---|---|---|---|
| [Playwriter](https://github.com/remorses/playwriter) | Chrome extension, CDP relay, Playwright, CLI/MCP; документирован remote access через relay и туннель | Наиболее близкий пример удалённого доступа к Chrome с существующими входами | Нужно проверить покрытие CDP и совместимость Live View; MIT |
| [Anomaly Browser Control](https://github.com/anomalyco/browser-control) | Существующий Chromium → расширение → локальный relay → агент; Playwright snippets | Сессии, reconnect, жизненный цикл relay, проверки origin, тесты | Основной описанный режим локальный; не готовая Hypermesh-интеграция; MIT |
| [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp) | Подключение по CDP endpoint, заголовки авторизации, режим extension для работающего Chrome/Edge | Пример поддержки нескольких способов подключения поверх одного набора действий | MCP-сервер не заменяет сетевую авторизацию и привязку нашего sidebar; Apache-2.0 |
| [OpenClaw](https://github.com/openclaw/openclaw) | Именованные browser profiles, remote CDP и node host на машине с браузером | Хороший образец маршрутизации: Gateway → удалённый узел → браузер | Большой продукт, не маленькая библиотека; текущие docs existing-session описывают Chrome DevTools MCP, а не extension relay; MIT |
| [Chrome MCP Server](https://github.com/hangwin/mcp-chrome) | Автоматизация повседневного Chrome через расширение с сохранением входов | UX и набор браузерных инструментов | Удалённый транспорт между машинами в просмотренных материалах не подтверждён; MIT |
| [Browser MCP](https://github.com/BrowserMCP/mcp) | MCP server + Chrome extension, локальная автоматизация существующего профиля | Простой пример продуктового сценария | README предупреждает: репозиторий нельзя собрать самостоятельно из-за зависимостей из другого monorepo; Apache-2.0 для опубликованного репозитория |
| [Browserless](https://github.com/browserless/browserless) | Серверная браузерная инфраструктура, подключение клиентов к браузерам | Вариант для выделенного удалённого Chrome, а не обязательно пользовательского профиля | SSPL-1.0 или коммерческая лицензия; нельзя считать обычной MIT-зависимостью |

## 1. Playwriter — наиболее прямой аналог

Документация описывает такую схему:

```text
Удалённый агент → защищённый туннель → relay рядом с Chrome
                                      ↕ локальный WebSocket
                                  Chrome extension → Chrome
```

Relay работает на машине пользователя. Удалённый клиент получает доступ к нему через туннель; в документации используется Traforo/Cloudflare. Для сетевого доступа предусмотрен токен; отдельно описан запуск из Docker с relay на хосте. Расширение позволяет работать с существующим профилем, не поднимая отдельный Chrome с debugging-портом.

В исходниках `cdp-relay.ts` видна пересылка `forwardCDPCommand` и работа с CDP sessionId; default host — loopback. Есть отдельный `extension/src/remote-tunnel.ts` с WebSocket и keepalive. Наличие этого файла само по себе не доказывает, что все варианты удалённого доступа используют одну и ту же схему.

**Что взять:** интерфейс relay и стратегию совместимости с Playwright. Вместо публичного Traforo использовать Hypermesh. Не предполагать полную эквивалентность extension CDP обычному browser-level CDP: создание targets, дочерние sessions, события и screencast требуют проверки.

Источники: [remote access](https://github.com/remorses/playwriter/blob/main/docs/remote-access.md), [CDP relay](https://github.com/remorses/playwriter/blob/main/playwriter/src/cdp-relay.ts), [extension remote tunnel](https://github.com/remorses/playwriter/blob/main/extension/src/remote-tunnel.ts).

## 2. Anomaly Browser Control — полезный образец надёжности

Основная схема: Agent/CLI → local relay → browser extension → существующий Chromium. Relay остаётся жить между CLI-вызовами; клиенты имеют отдельные сессии. README описывает ограниченное ожидание reconnect расширения. В исходниках есть проверки WebSocket origin и отдельное управление CDP-клиентами.

Особенно полезен набор тестов: handshake расширения, сохранение сессий, порядок ввода, shutdown, дедупликация дочерних targets, защищённые frames. Это хороший список проблем, которые придётся решить и нам. Наличие тестов не заменяет их запуск и аудит.

Источники: [README](https://github.com/anomalyco/browser-control#readme), [relay](https://github.com/anomalyco/browser-control/blob/main/src/relay.ts), [тесты](https://github.com/anomalyco/browser-control/tree/main/test).

## 3. OpenClaw — архитектурный аналог удалённых узлов

В текущей документации различаются локальный браузер, remote CDP и node host на машине с Chrome. Gateway проксирует браузерные действия на узел. Именованные профили выбирают конкретное подключение. Важная деталь: действие с конкретным targetId не должно запускать новый браузер, потому что нужной вкладки в нём быть не может.

Для Hyper это аргумент в пользу явного browserId и режима attach-only: потеря соединения не должна незаметно переключать агента на локальный Chrome или создавать другой профиль.

Источники: [remote browsers](https://github.com/openclaw/openclaw/blob/main/docs/tools/browser/remote.md), [profiles и existing session](https://github.com/openclaw/openclaw/blob/main/docs/tools/browser/existing-session.md).

## 4. Playwright MCP — единый API, разные подключения

README документирует `--cdp-endpoint`, `--cdp-header`, `--cdp-timeout` и `--extension`. Это подтверждает, что удалённый CDP и работа с уже открытым пользовательским браузером могут сосуществовать за одним высокоуровневым API.

Для Hyper стоит перенять именно разделение инструментов и транспорта, а не обязательно внедрять MCP. Авторизация пользователя в sidebar, доступ Hyper к браузеру и авторизация внутри сайтов — три разные вещи.

Источник: [README и параметры](https://github.com/microsoft/playwright-mcp#readme).

## Предлагаемая архитектура Hyper

```text
Hyper browser API
   ↓ выбирает browserId
   ├─ direct-cdp → Hypermesh → CDP выделенного Chrome
   └─ extension-relay → Hypermesh → локальный relay → extension → обычный Chrome

Sidebar binding = пользователь + browserId + browserEpoch + tabId + targetId
```

Это предложение для нашего проекта, не уже реализованная возможность.

1. **Реестр браузеров.** Стабильный browserId, владелец/допуски, transport, адрес или secret reference, статус. Сессии, кеши, refs и очереди действий разделять по браузерам.
2. **Первый этап — direct CDP.** Проверить существующий plugin через Hypermesh с отдельным Chrome. Сохранить API navigate/snapshot/act. Не запускать локальный браузер при недоступности удалённого.
3. **Второй этап — extension relay.** Расширение явно подключает разрешённые вкладки через chrome.debugger; локальный relay предоставляет совместимый интерфейс. За основу исследования взять Playwriter, а не писать протокол с нуля.
4. **Sidebar.** Текущая привязка targetId недостаточна при нескольких Chrome. Сервер должен проверять target в указанном браузере; browserId от расширения не является доказательством права доступа.
5. **Live View.** Отдельно проверить Page.startScreencast, Input, отсоединение DevTools и поведение фоновых вкладок через extension transport. Пока не обещать полную совместимость.

## Безопасность и минимальная проверка прототипа

- CDP даёт широкие полномочия над профилем. VPN защищает канал, но не заменяет авторизацию конкретного Hyper и выбор разрешённых вкладок.
- Не публиковать незащищённый CDP в интернет. Для машинного соединения нужны права/учётные данные: интерактивная portal-сессия человека не автоматически подходит агенту.
- Существующий sidebar pairing token нельзя автоматически считать разрешением на управление Chrome.
- При потере связи не повторять автоматически отправку формы, платёж или удаление: результат последней команды может быть неизвестен.
- Проверить два браузера с одинаковыми URL, смену target, рестарт расширения, истечение/отзыв доступа, задержки, reconnect, отсутствие перетекания refs между сессиями.
- Для CDP через прокси проверить `/json/version` и возвращаемый WebSocket URL: loopback-адрес удалённой машины не должен восприниматься как localhost сервера Hyper.

## Итоговая рекомендация

**Быстрый прототип:** наш browser plugin + remote CDP через Hypermesh. **Удобный пользовательский вариант:** наш Chrome extension + локальный CDP relay по модели Playwriter, доступный через Hypermesh. Сначала сделать общую модель browserId и проверить совместимость на одной удалённой машине. Решение о заимствовании кода принимать после чтения лицензий, тестов и проверки полного пути snapshot → act → Live View.
