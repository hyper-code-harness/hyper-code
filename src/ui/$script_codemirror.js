// Bundle entry: everything our UI loads at runtime, collected so Bun.build
// can ship one static /ui/codemirror.js instead of N esm.sh requests (loaded on demand by files/editor.js).
// Exposes `window.__cm` for files/$script_editor.js to consume.


import * as view from "@codemirror/view";
import * as state from "@codemirror/state";
import * as language from "@codemirror/language";
import * as commands from "@codemirror/commands";
import * as search from "@codemirror/search";
import * as autocomplete from "@codemirror/autocomplete";
import * as lint from "@codemirror/lint";

import * as langJs from "@codemirror/lang-javascript";
import * as langMd from "@codemirror/lang-markdown";
import * as langJson from "@codemirror/lang-json";
import * as langHtml from "@codemirror/lang-html";
import * as langCss from "@codemirror/lang-css";
import * as langSql from "@codemirror/lang-sql";

import * as vim from "@replit/codemirror-vim";

window.__cm = {
    view, state, language, commands, search, autocomplete, lint,
    langs: {
        javascript: langJs, markdown: langMd, json: langJson,
        html: langHtml, css: langCss, sql: langSql,
    },
    vim,
};
