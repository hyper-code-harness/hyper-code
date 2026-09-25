// The labelled set behind runtime.docs.ragBenchmark.
//
// The `synthetic` cases are the original hand-written probes. They are easy:
// eight of nine restate a function's own summary, so a lexical retriever passes
// them almost by construction.
//
// The `transcript` cases were mined from real agent history: every user prompt
// was paired with the ctx.fns.* calls the agent actually made next, which gave
// 4649 pairs and 443 unambiguous ones. They were then filtered BY HAND, because
// "what the agent called" is not "what was correct" — prompts that only make
// sense inside their conversation, and calls the agent made for its own
// bookkeeping, were dropped. What survives has the properties the synthetic set
// lacks: typos, ellipsis, Russian, jargon, and no vocabulary overlap with the
// documentation.
//
// Negatives come from the same history: prompts after which the agent called
// nothing at all. They are the majority of real conversation and the reason
// no-result precision matters more than recall.

/** Returns the labelled retrieval intents used to score runtime-function search. */
/**
 * Provide the evaluation corpus for `runtime.docs.ragBenchmark`.
 *
 * Use when scoring retrieval or reranking changes, or when adding a case after
 * observing a real miss. Cases are data, not behaviour: nothing here calls a
 * model or touches the database.
 *
 * @param opts.source Restrict to hand-written probes or transcript-mined cases.
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** Return only cases of this origin; omit for the full set. */
    source?: "synthetic" | "transcript";
}): types.runtime.docs.RagCase[] {
    return opts.source ? CASES.filter((item) => (item.source ?? "synthetic") === opts.source) : CASES;
}

const CASES: types.runtime.docs.RagCase[] = [
    // ---- original hand-written probes -------------------------------------
    { query: "send a telegram message", expected: ["telegram.send"], relevant: ["telegram.sendFile", "telegram.messages"], source: "synthetic" },
    { query: "read only duckdb sql", expected: ["duckdb.query"], relevant: ["duckdb.run", "duckdb.ndjson"], source: "synthetic" },
    { query: "wait until a condition becomes true then resume the agent", expected: ["agent.wakeUpWhen", "agent.waitForEvent"], source: "synthetic" },
    { query: "list unread gmail messages", expected: ["gmail.list"], relevant: ["gmail.get"], source: "synthetic" },
    { query: "create a GitHub issue", expected: ["gh.createIssue"], relevant: ["gh.issues", "gh.issue"], source: "synthetic" },
    { query: "find a place near me", expected: ["gplaces.nearby", "gplaces.search"], source: "synthetic" },
    { query: "read a file with line anchors", expected: ["files.readHashline"], relevant: ["files.formatHashline"], source: "synthetic" },
    { query: "schedule agent wake up tomorrow", expected: ["agent.wakeAt", "agent.wakeIn"], relevant: ["agent.wakeUpWhen"], source: "synthetic" },
    { query: "thanks, continue", expected: [], noResult: true, source: "synthetic" },
    { query: "make this prettier", expected: [], noResult: true, source: "synthetic" },
    { query: "hello how are you", expected: [], noResult: true, source: "synthetic" },
    { query: "спасибо продолжай", expected: [], noResult: true, source: "synthetic" },
    { query: "проверить почту", expected: ["gmail.list", "gmail.get"], source: "synthetic" },

    // ---- mined from real transcripts, hand-checked ------------------------
    // Messaging and mail.
    { query: "отправь сообщение в телеграм", expected: ["telegram.send"], relevant: ["telegram.dialogs", "telegram.findChat"], source: "transcript" },
    { query: "закинь это в telegram bizdev", expected: ["telegram.send"], relevant: ["telegram.findChat"], source: "transcript" },
    { query: "кто нибудь мне пишет в личку?", expected: ["telegram.dialogs", "telegram.messages"], source: "transcript" },
    { query: "давай теперь telegram reauth", expected: ["telegram.reauth"], source: "transcript" },
    { query: "оправь mary ryzhikova в telegram", expected: ["telegram.send", "telegram.findChat"], source: "transcript" },
    { query: "А сейчас почта работает?", expected: ["gmail.list"], relevant: ["gmail.get"], source: "transcript" },
    { query: "пометь письмо прочитанным", expected: ["gmail.modify"], source: "transcript" },
    { query: "отпишись в чат zulip", expected: ["zulip.send"], source: "transcript" },
    { query: "найди упоминания сроков в зулипе", expected: ["zulip.messages"], relevant: ["zulip.search"], source: "transcript" },

    // Calendar and places.
    { query: "когда у нас сегодня визит?", expected: ["gcal.events"], source: "transcript" },
    { query: "добавь на рабочую почту встречу", expected: ["gcal.create"], source: "transcript" },
    { query: "Во сколько открывается первая", expected: ["gplaces.details"], relevant: ["gplaces.search"], source: "transcript" },

    // Repository and delivery.
    { query: "запиши эти документы к нам в репу", expected: ["gh.api", "gh.repo"], relevant: ["git.stageCommitPush"], source: "transcript" },
    { query: "и добавь all samurai team как contributors", expected: ["gh.api"], source: "transcript" },
    { query: "закинь в gist", expected: ["gh.gist.update", "docs.gist"], source: "transcript" },
    { query: "А поставь новую версию на мой ipad", expected: ["mobiledev.install"], source: "transcript" },
    { query: "запушь на телефон", expected: ["mobiledev.install"], source: "transcript" },

    // Research and reading.
    { query: "а поищи про task driven ui", expected: ["research.ask", "research.search"], relevant: ["websearch.search"], source: "transcript" },
    { query: "простыми словами распиши с цитатами исследования", expected: ["research.ask"], source: "transcript" },
    { query: "а где можно купить jev?", expected: ["websearch.search"], relevant: ["browser.googleSearch"], source: "transcript" },
    { query: "можешь поискать в circleback sql on fhir", expected: ["circleback.meetings"], relevant: ["circleback.meeting"], source: "transcript" },
    { query: "Что конкретно говорил Джон найди цитаты", expected: ["circleback.meeting", "circleback.meetings"], source: "transcript" },
    { query: "а какие сейчас фиды в hacker news?", expected: ["hackernews.listFeeds"], source: "transcript" },
    { query: "а прочитай https://docs.art-decor.org/clinicalmodeling/", expected: ["browser.navigate", "browser.snapshot"], relevant: ["browser.readPage"], source: "transcript" },
    { query: "открой ребят во вкладках - я добавлю", expected: ["browser.navigate"], relevant: ["browser.tabs"], source: "transcript" },

    // Health repository.
    { query: "поносик - но мало", expected: ["healthrepo.createDiary"], source: "transcript" },
    { query: "курица и чай; 15:40 достаточно оформленный стул", expected: ["healthrepo.createDiary"], relevant: ["healthrepo.reindex"], source: "transcript" },
    { query: "Положи его по правилам собери в один документ с типом временем и врачом", expected: ["healthrepo.documents"], source: "transcript" },

    // Runtime and infrastructure.
    { query: "Сколько он потянул за последний раз крон", expected: ["cron.runs"], source: "transcript" },
    { query: "А синки новостей живые в cron?", expected: ["cron.list"], relevant: ["cron.runs"], source: "transcript" },
    { query: "Как можно для hyper использовать? Может functions инжектить?", expected: ["runtime.docs.search"], relevant: ["runtime.docs.get"], source: "transcript" },
    { query: "давай залинкуемся в .hyper/user plugins", expected: ["plugins.load", "plugins.add"], relevant: ["plugins.list"], source: "transcript" },
    { query: "Найди тогда pubmed и nlm плагины", expected: ["plugins.search"], source: "transcript" },
    { query: "давай залогинелся в лузиадаш", expected: ["lusiadas.ensureLogin"], source: "transcript" },
    { query: "обнови codex проверь", expected: ["llm.refreshCodex"], source: "transcript" },

    // Negatives mined from prompts after which the agent called nothing.
    { query: "а в чем разница на пальцах", expected: [], noResult: true, source: "transcript" },
    { query: "что такое primary care?", expected: [], noResult: true, source: "transcript" },
    { query: "расскажи не делай", expected: [], noResult: true, source: "transcript" },
    { query: "ну дай оценку какую нибудь?", expected: [], noResult: true, source: "transcript" },
    { query: "пока не делай - просто обсуждаем", expected: [], noResult: true, source: "transcript" },
    { query: "Те они продают скорость", expected: [], noResult: true, source: "transcript" },
    { query: "как они себя позиционируют", expected: [], noResult: true, source: "transcript" },
    { query: "В будущем надеюсь таких ошибок не будет", expected: [], noResult: true, source: "transcript" },
    { query: "а в итоге что они делают", expected: [], noResult: true, source: "transcript" },
    { query: "что дальше?", expected: [], noResult: true, source: "transcript" },
    { query: "пиши простым легко читаемым языком с примерами", expected: [], noResult: true, source: "transcript" },
    { query: "имеет ли смысл сразу и извлекать сущности?", expected: [], noResult: true, source: "transcript" },
];
