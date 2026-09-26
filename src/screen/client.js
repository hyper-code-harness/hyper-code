// The browser half of driving the workspace — served at GET /page/client.js and
// loaded by the layout, so `window.page` exists on every page.
//
// Everything the workspace does to the open tab resolves an element the same
// way: by the data-* markers ui/attr.ts emits, never by a CSS selector. One
// resolver here means a restyle cannot break the agent, and the catalogue
// `state()` returns is built by that same resolver — so anything it reports is
// something the workspace can actually act on. That is the whole contract: ask
// what is on screen, act on what came back.
//
// The cursor is not decoration. When the workspace clicks something on the
// user's behalf, a pointer flies there and the target lights up, so a person
// watching sees what happened instead of the page changing under them.

(() => {
  let lastViewport = null;
    if (window.page) return;

    const sel = (name, value) => "[data-" + name + "=" + JSON.stringify(String(value)) + "]";
    const textOf = el => (el?.innerText ?? el?.textContent ?? "").trim().replace(/\s+/g, " ");

    // ── resolving a descriptor ────────────────────────────────────────────────
    // Precedence, most specific first. `entity` narrows an action to one row;
    // `form` narrows a field to one form. A miss throws with the selector it
    // tried, which is the only useful thing to say.
    function find(d) {
        if (d.form && d.field) {
            const scope = one(sel("form", d.form), "form");
            const control = controlsFor(scope, d.field)[0];
            if (!control) throw new Error("no field " + JSON.stringify(d.field) + " in form " + JSON.stringify(d.form));
            return control;
        }
        if (d.form && d.action) return within(one(sel("form", d.form), "form"), sel("action", d.action), "action");
        if (d.form) return one(sel("form", d.form), "form");
        if (d.action) {
            const scope = d.entity ? entity(d) : document;
            return within(scope, sel("action", d.action) + (d.id && !d.entity ? sel("id", d.id) : ""), "action");
        }
        if (d.entity) return entity(d);
        if (d.section) return one(sel("section", d.section), "section");
        if (d.role) return one(sel("role", d.role), "role");
        throw new Error("need {entity} | {action} | {form} | {section} | {role}, got " + JSON.stringify(d));
    }

    function entity(d) {
        return one(sel("entity", d.entity) + (d.id ? sel("id", d.id) : ""), "entity");
    }

    function one(selector, what) {
        const el = document.querySelector(selector);
        if (!el) throw new Error("no " + what + ": " + selector);
        return el;
    }

    function within(scope, selector, what) {
        const el = (scope === document ? document : scope).querySelector(selector) ?? (scope !== document && scope.matches?.(selector) ? scope : null);
        if (!el) throw new Error("no " + what + ": " + selector);
        return el;
    }

    // Fields resolve by native name first, then by the `data-field` marker, then
    // by a formbox question container (a rendered Questionnaire names its inputs
    // `fb[answer][<linkId>][value]`, which nobody wants to type).
    function controlsFor(scope, name) {
        const byName = [...scope.querySelectorAll("[name=" + JSON.stringify(name) + "], [name=" + JSON.stringify(name + "[]") + "]")];
        if (byName.length) return byName;
        const marked = [...scope.querySelectorAll(sel("field", name))];
        if (marked.length) return marked;
        const question = scope.querySelector("[data-fb-question=" + JSON.stringify(name) + "], [data-linkid=" + JSON.stringify(name) + "]");
        if (question) return [...question.querySelectorAll("select, textarea, input:not([type=hidden])")];
        return [];
    }

    function fieldNames(scope) {
        const names = new Set();
        for (const el of scope.querySelectorAll("[name]")) if (el.name && !/^fb\[/.test(el.name) && el.type !== "hidden") names.add(el.name);
        for (const el of scope.querySelectorAll("[data-field]")) names.add(el.dataset.field);
        for (const el of scope.querySelectorAll("[data-fb-question], [data-linkid]")) names.add(el.dataset.fbQuestion ?? el.dataset.linkid);
        return [...names];
    }

    // ── what is on the screen ────────────────────────────────────────────────
    // Only the right pane is reported. The chat is the other half of the window
    // and it is full of its own markers; an agent asking what is on screen means
    // the page it is driving, not the transcript of its own conversation.
    function state(opts = {}) {
        const pane = scopeOf(opts.scope);
        return {
            url: location.pathname + location.search,
            title: document.title,
            page: pane.querySelector?.("[data-page]")?.dataset.page ?? pane.querySelector?.("h1")?.textContent?.trim() ?? null,
            // A tab is an entity like any other — `data-entity="tab"`, `data-id`,
            // `data-status` — so it is read by its markers, like everything else
            // here: a strip whose tabs are spans wrapping a link (and they are)
            // has no href to read, and its classes are the styling's business.
            // The × inside a tab carries the same entity so it can be addressed
            // as one; it is an action, not the tab. A strip too narrow to show
            // every word puts the rest in a tooltip, so a tab with no visible
            // text is not a nameless tab.
            tabs: [...document.querySelectorAll(sel("entity", "tab") + ":not([data-action])")].map(t => ({
                tab: t.dataset.id ?? null,
                label: textOf(t) || t.title || t.querySelector("[title]")?.title || "",
                active: t.dataset.status === "active",
            })),
            entities: [...pane.querySelectorAll("[data-entity]")].map(el => ({
                entity: el.dataset.entity,
                id: el.dataset.id ?? null,
                status: el.dataset.status ?? null,
                text: textOf(el).slice(0, 120),
                fields: Object.fromEntries([...el.querySelectorAll("[data-role]")].map(r => [r.dataset.role, textOf(r).slice(0, 120)])),
                href: el.tagName === "A" ? el.getAttribute("href") : el.querySelector("a[href]")?.getAttribute("href") ?? null,
            })),
            actions: [...pane.querySelectorAll("[data-action]")].map(el => ({
                action: el.dataset.action,
                id: el.dataset.id ?? el.closest("[data-entity]")?.dataset.id ?? null,
                entity: el.closest("[data-entity]")?.dataset.entity ?? null,
                text: textOf(el).slice(0, 60),
            })),
            // Named regions of the page — what a tour's `point` stands on when it
            // explains parts of a screen rather than things in it.
            sections: [...pane.querySelectorAll("[data-section]")].map(el => ({ section: el.dataset.section, text: textOf(el).slice(0, 80) })),
            forms: [...pane.querySelectorAll("[data-form]")].map(el => ({ form: el.dataset.form, fields: fieldNames(el) })),
            // The result of the last in-place action, read off the page: the page
            // notifications, and every field that failed validation with its message.
            notices: [...pane.querySelectorAll('[data-role="notice"]')].map(el => ({ tone: el.dataset.tone ?? "info", text: textOf(el).slice(0, 160) })),
            invalid: [...pane.querySelectorAll("[data-invalid]")].map(el => {
                const e = el.querySelector('[data-role="error"]');
                return { field: el.dataset.field ?? null, error: e ? textOf(e).slice(0, 120) : "" };
            }),
            text: opts.text === false ? undefined : textOf(pane).slice(0, opts.maxText ?? 4000),
        };
    }

    function scopeOf(scope) {
        if (scope === "body") return document.body ?? document;
        if (scope === "chat") return document.querySelector("#chat-panel") ?? document.body ?? document;
        return document.querySelector("#main") ?? document.body ?? document;
    }

    // ── the cursor, the highlight and the caption ────────────────────────────
    let pointer, ring, caption, fade;

    function chrome() {
        if (pointer) return;
        pointer = document.createElement("div");
        pointer.id = "page-pointer";
        pointer.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 3l14 8-6 1.5L10 19z" fill="#1c1917" stroke="#fff" stroke-width="1.2"/></svg>`;
        ring = document.createElement("div");
        ring.id = "page-ring";
        caption = document.createElement("div");
        caption.id = "page-caption";
        for (const el of [pointer, ring, caption]) { el.style.opacity = "0"; document.body.appendChild(el); }
    }

    // Fly the pointer to an element, light it up, and leave both visible long
    // enough to be seen. Off-screen targets are scrolled to first — pointing at
    // something nobody can see is worse than not pointing.
    async function moveTo(el, opts = {}) {
        chrome();
        const box = () => el.getBoundingClientRect();
        if (box().top < 8 || box().bottom > window.innerHeight - 8) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            await new Promise(r => setTimeout(r, 320));
        }
        const r = box();
        pointer.style.left = Math.round(r.left + Math.min(r.width * 0.5, 40)) + "px";
        pointer.style.top = Math.round(r.top + Math.min(r.height * 0.5, 18)) + "px";
        Object.assign(ring.style, { left: Math.round(r.left - 4) + "px", top: Math.round(r.top - 4) + "px", width: Math.round(r.width + 8) + "px", height: Math.round(r.height + 8) + "px" });
        pointer.style.opacity = "1";
        ring.style.opacity = "1";
        clearTimeout(fade);
        fade = setTimeout(hide, opts.holdMs ?? 2600);
        await new Promise(r => setTimeout(r, opts.delay ?? 550));
        return r;
    }

    function hide() {
        for (const el of [pointer, ring, caption]) if (el) el.style.opacity = "0";
    }

    function pulse() {
        if (!ring) return;
        // Optional because a flourish must never be what stops a click landing.
        ring.animate?.([{ transform: "scale(1)" }, { transform: "scale(0.96)" }, { transform: "scale(1)" }], { duration: 260 });
    }

    // A caption anchored under whatever is being pointed at: the narration half
    // of a tour. Without it the pointer moves and the user has to guess why.
    async function say(opts) {
        chrome();
        const el = opts.entity || opts.action || opts.form || opts.role ? find(opts) : null;
        if (el) await moveTo(el, { delay: 0, holdMs: opts.ms ?? 4000 });
        const r = el ? el.getBoundingClientRect() : { left: window.innerWidth / 2 - 160, bottom: 80, width: 320 };
        caption.textContent = opts.text;
        caption.style.opacity = "1";
        caption.style.left = Math.round(Math.max(12, Math.min(r.left, window.innerWidth - 380))) + "px";
        caption.style.top = Math.round(Math.min(r.bottom + 10, window.innerHeight - 80)) + "px";
        clearTimeout(fade);
        fade = setTimeout(hide, opts.ms ?? 4000);
        return { said: opts.text };
    }

    // Wait for htmx to finish, rather than guessing with a sleep: a route that
    // goes to the network takes as long as it takes, and the workspace reading
    // the pane before the swap lands is how an agent ends up describing the
    // previous page. If no request starts at all — a checkbox, a menu — there is
    // nothing to wait for and we return at once.
    function settle(act) {
        return new Promise(resolve => {
            let started = false, done = false;
            const finish = () => {
                if (done) return;
                done = true;
                window.removeEventListener("htmx:before:request", onStart, true);
                document.removeEventListener("htmx:after:swap", finish);
                resolve();
            };
            const onStart = () => { started = true; };
            window.addEventListener("htmx:before:request", onStart, true);
            document.addEventListener("htmx:after:swap", finish);
            act();
            setTimeout(() => { if (!started) finish(); }, 200);
            setTimeout(finish, 8000);         // a route slower than this is broken, not slow
        });
    }

    // ── the tour ─────────────────────────────────────────────────────────────
    // A tour is played HERE, by the person taking it. The server hands the whole
    // scenario over in one call and steps back — nothing advances on a timer,
    // and nothing moves anybody anywhere they did not press for.
    //
    // That is the fix for the tour this replaces: it ran server-side on
    // `sleep`, so screens changed under the reader between captions that faded
    // on their own, and the only thing a person could do about any of it was
    // watch. A step that leads somewhere now lights up the control that leads
    // there and waits for the reader to press it themselves; `Show me` presses
    // it for them, and `Guide me` makes that the rest of the tour.
    let tour = null, dim = null, spot = null, panel = null, awaiting = null, auto = null;
    const KEEP = "tour.play";     // so a reload resumes rather than loses it
    const KEEP_FOR = 30 * 60 * 1000;    // …but not for ever, see the restore below
    // How long a guided step is left on the screen before the tour takes it. Long
    // enough to read three lines and decide to stop it; the bar is what makes the
    // number unnecessary to state.
    const GUIDED_MS = 7000;

    // Client-side counterpart of procs.ui.button for controls created after page load.
    // Dynamic widgets must use this factory instead of embedding raw button markup.
    function actionButton({ action, label = "", className = "", ariaLabel = "" }) {
        const control = document.createElement("button");
        control.type = "button";
        control.className = className;
        control.dataset.action = action;
        control.textContent = label;
        if (ariaLabel) control.setAttribute("aria-label", ariaLabel);
        return control;
    }


    function tourChrome() {
        if (panel) return;
        // The dim is a full-viewport layer with the lit rectangle inside it, so
        // the layer can be CLIPPED to the app while the rectangle keeps
        // viewport coordinates. (A clip-path on the rectangle itself is
        // relative to its own box, which clips the dimming away entirely.)
        dim = document.createElement("div");
        dim.id = "page-dim";
        spot = document.createElement("div");
        spot.id = "page-spot";
        spot.style.opacity = "0";
        dim.append(spot);
        panel = document.createElement("div");
        panel.id = "page-tour";
        panel.innerHTML = `<div class="page-tour__head">
    <span data-role="count"></span>
    <span data-control="exit-head"></span>
  </div>
  <p class="page-tour__text" data-role="text"></p>
  <p class="page-tour__where" data-role="where"></p>
  <div class="page-tour__foot">
    <span data-control="back"></span>
    <span data-control="next"></span>
  </div>
  <div class="page-tour__end">
    <span class="page-tour__dots" data-role="dots"></span>
    <span data-control="guide"></span>
    <span data-control="exit-end"></span>
  </div>
  <div class="page-tour__timer"><i data-role="timer"></i></div>`;
        panel.querySelector('[data-control="exit-head"]').replaceWith(actionButton({ action: "exit", label: "✕", ariaLabel: "End the tour" }));
        panel.querySelector('[data-control="back"]').replaceWith(actionButton({ action: "back", label: "Back", className: "page-tour__ghost" }));
        panel.querySelector('[data-control="next"]').replaceWith(actionButton({ action: "next", className: "page-tour__go" }));
        panel.querySelector('[data-control="guide"]').replaceWith(actionButton({ action: "guide", className: "page-tour__ghost" }));
        panel.querySelector('[data-control="exit-end"]').replaceWith(actionButton({ action: "exit", label: "End tour", className: "page-tour__ghost" }));
        document.body.append(dim, panel);
        panel.addEventListener("click", event => {
            const action = event.target.closest("[data-action]")?.dataset.action;
            if (action === "exit") tourEnd();
            else if (action === "back") tourGo(-1);
            else if (action === "next") tourNext();
            else if (action === "guide") {
                // Taking over is an ACT, not a preference: pressing "Guide me
                // through it" and watching a label change is indistinguishable
                // from pressing a dead button. So it turns the mode on and
                // carries on from here.
                tour.guided = !tour.guided;
                if (tour.guided) tourNext(); else { stopAuto(); tourDraw(); }
            }
        });
        window.addEventListener("resize", () => tour && light());
        window.addEventListener("scroll", () => tour && light(), true);
    }

    // What this step is about — the thing it acts on, or the thing it merely
    // points at. Same precedence the server's `tour` used, so a scenario written
    // for one plays in the other.
    function targetOf(step) {
        const own = { entity: step.entity, id: step.id, action: step.action, form: step.form, field: step.field, role: step.role, section: step.section };
        if (Object.values(own).some(Boolean)) return own;
        if (step.point) return step.point;
        if (step.click) return step.click;
        if (step.submit) return { form: step.submit };
        if (step.fill) return { form: step.fill.form };
        if (step.open && typeof step.open === "object" && !step.open.url) return step.open;
        return null;
    }

    // What this step still has to DO once the reader is on its page. `open` is
    // not in here: travelling happens on the way in (`enter`), so by the time a
    // step is on screen its journey is already made.
    function actOf(step) {
        return step.click ? "click" : step.submit ? "submit" : step.fill ? "fill" : null;
    }

    // The control this step is about, if it names one and the page has it.
    function target(step) {
        const named = targetOf(step);
        if (!named) return null;
        try { return find(named); } catch { return null; }
    }

    function found(step) {
        const named = target(step);
        if (named) return named;
        // A step that names nothing is talking about the page it is on — so the
        // page is what lights up. Without this, a narration step dimmed nothing
        // and lit nothing, and a step that navigated changed the screen with no
        // mark on it at all: "экраны просто меняются, ничего непонятно".
        return heading();
    }

    // The page's own name on screen — its heading, and only that. Outlining the
    // whole page instead (its `data-page` element) marks everything, which is the
    // same as marking nothing; a page with no heading is left unmarked and the
    // panel's own "Now: …" line is what says where this is.
    function heading() {
        return (document.querySelector("#main") ?? document.body)?.querySelector("h1, h2") ?? null;
    }

    // …and the same thing in words, for the panel: what a person would call this
    // screen, not the slug the markup files it under.
    // Who a page is about, off its address — every host spells it the same way
    // (`/ehr/patient/<id>`, `/portal/patient/<id>`), which is the whole benefit
    // of one address per screen. `open` is a url or a descriptor; only the url
    // form names anybody here, and a step that opens by descriptor is followed
    // through the link it lands on, where the name is on the page anyway.
    function subjectOf(open) {
        const url = typeof open === "string" ? open : open?.url ?? (typeof open === "object" ? "" : open);
        return /\/patient\/([^/?#]+)/.exec(url ?? "")?.[1] ?? null;
    }

    function placeName() {
        const h = document.querySelector("#main")?.querySelector("h1");
        const said = textOf(h) || document.title.split(" · ")[0] || document.querySelector("[data-page]")?.dataset.page;
        return (said ?? "").slice(0, 60);
    }

    // The hole in the dimming. A step whose target is not on the page dims
    // nothing at all: a grey screen with nothing lit reads as broken.
    function light() {
        const el = tour && found(tourStep());
        if (!el) { spot.style.opacity = "0"; return; }
        // Dim the page around a control the step names; merely OUTLINE the
        // page's own heading when it names none — dimming a screen somebody is
        // being told about hides the thing being described.
        dim.dataset.mark = target(tourStep()) ? "target" : "page";
        // The dimming stops at the app: the harness around it — the tab strip,
        // the chat somebody is having about all this — is not part of what is
        // being explained, and greying it out reads as "this is disabled now".
        // Unless the step is ABOUT something over there, in which case dimming
        // it would hide the very thing being pointed at.
        dim.dataset.scope = document.querySelector("#main")?.contains(el) ? "app" : "window";
        const r = el.getBoundingClientRect();
        if (r.top < 8 || r.bottom > window.innerHeight - 8) el.scrollIntoView({ behavior: "smooth", block: "center" });
        Object.assign(spot.style, {
            left: Math.round(r.left - 6) + "px", top: Math.round(r.top - 6) + "px",
            width: Math.round(r.width + 12) + "px", height: Math.round(r.height + 12) + "px", opacity: "1",
        });
    }

    function tourStep() { return tour ? tour.steps[tour.i] : null; }

    // A failed step, said to the person taking the tour rather than to whoever
    // wrote it. The verbs throw with the marker they looked for —
    // `no entity: [data-entity="todo"][data-id="intake"]` — which is the right
    // message for a REPL and a CSS selector in the face of somebody being shown
    // around. What they need to know is that the tour is talking about something
    // this page does not have, and that they can step over it.
    function missing(error) {
        const said = String(error?.message ?? error);
        const name = /data-(?:id|action|form|role)="([^"]*)"/.exec(said)?.[1];
        return name
            ? `This step is about “${name}”, and this page has nothing by that name.`
            : `This step could not be done here: ${said.slice(0, 120)}`;
    }

    // A step that leads SOMEWHERE ELSE travels on the way in, not on the way
    // out — see `enter`. What is left here are the acts on the page in front of
    // the reader.
    async function perform(step) {
        if (step.fill) await window.page.fill(step.fill);
        if (step.submit) await window.page.submit({ form: step.submit });
        if (step.click) await window.page.click(step.click);
    }

    // Waiting for the reader's own press is the guided half: the same click they
    // would have made anyway is what moves the tour on, so the transition is
    // theirs and they know exactly what caused it.
    function stopWaiting() {
        if (!awaiting) return;
        window.removeEventListener("click", awaiting, true);
        awaiting = null;
    }

    // Guided means the tour walks itself: a step is read, and after GUIDED_MS it
    // is taken. It used to mean only that the panel would press the control for
    // whoever pressed "Guide me through it" — one step, and then it sat waiting
    // for the next press, which is the manual mode with a different label on the
    // button.
    //
    // The bar is not decoration: a screen that changes on a timer with nothing
    // saying when is the tour this player replaced. It fills across the foot of
    // the panel, so the next move is visible before it happens and there is a
    // moment in which to stop it — "I'll click myself" cancels the timer and
    // hands the tour back.
    function stopAuto() {
        if (auto) { clearTimeout(auto); auto = null; }
        const bar = panel?.querySelector('[data-role="timer"]');
        if (!bar) return;
        bar.style.transition = "none";
        bar.style.width = "0%";
    }

    function startAuto() {
        stopAuto();
        const bar = panel.querySelector('[data-role="timer"]');
        // The reset has to land before the fill is asked for, or the two are one
        // style change and nothing animates.
        void bar.offsetWidth;
        bar.style.transition = `width ${GUIDED_MS}ms linear`;
        bar.style.width = "100%";
        auto = setTimeout(() => { auto = null; tourNext(); }, GUIDED_MS);
    }

    function waitForClick(el) {
        stopWaiting();
        awaiting = event => {
            if (!el.contains(event.target) && event.target !== el) return;
            stopWaiting();
            if (tour) tour.how = "did-it";           // their own press, not ours
            setTimeout(() => tourGo(1), 420);        // after the swap it caused
        };
        window.addEventListener("click", awaiting, true);
    }

    // The person's answer, written back — the same fire-and-forget beacon as
    // `/screen/here`. A live step is a turn in a conversation: whoever guides
    // (the chat agent, a REPL loop) said their piece with `page.step`, and the
    // press is the floor coming back to them. Nothing waits on a wire for it.
    function press(said) {
        try {
            window.navigator.sendBeacon?.("/screen/press", new Blob([JSON.stringify({
                ...said, url: location.pathname + location.search, at: new Date().toISOString(),
            })], { type: "application/json" }));
        } catch { /* a press is not worth an error */ }
    }

    function tourDraw() {
        const step = tourStep();
        if (!step) return;
        stopWaiting();
        tourChrome();
        const el = target(step);                 // the control it names, if any
        const act = actOf(step);
        const self = !tour.guided && act === "click" && el;    // they press it themselves

        // A solo step is one turn of a live conversation, not "Step 1 of 1" of a
        // one-step excursion: no count, no dots, no Back, no guided mode.
        panel.querySelector('[data-role="count"]').textContent = tour.solo ? (tour.title || " ") : `Step ${tour.i + 1} of ${tour.steps.length}`;
        panel.querySelector('[data-role="text"]').textContent = step.say ?? "";
        panel.querySelector('[data-role="where"]').textContent = tour.stuck ? tour.stuck
            : self ? "Press the highlighted control — the tour follows you."
            : tour.guided ? `Now: ${placeName()} · moving on by itself`
            : `Now: ${placeName()}`;
        // The button says what pressing it will DO. "Next →" over a step that
        // jumps to another screen is how a tour becomes screens changing for no
        // reason a person can see.
        const go = panel.querySelector('[data-action="next"]');
        const last = !tour.solo && tour.i === tour.steps.length - 1;
        const away = tour.steps[tour.i + 1]?.open;      // the next step is elsewhere
        // …and if it is elsewhere ABOUT SOMEBODY ELSE, the button says whose.
        // A tour that walks from one patient's portal to another's says "Take me
        // there →" and lands on a different name in the same layout, which reads
        // as the app having lost the patient rather than as a deliberate step.
        const here = subjectOf(step.open) ?? subjectOf(location.pathname);
        const who = subjectOf(away) && subjectOf(away) !== here ? subjectOf(away) : null;
        go.textContent = tour.stuck ? (last ? "Done" : "Step over it →")
            : self ? "Show me"
            : act ? (tour.guided ? "Got it →" : "Do it →")
            : last ? "Done"
            : who ? `Take me to ${who} →`
            : away ? "Take me there →"
            : "Next →";
        const back = panel.querySelector('[data-action="back"]');
        back.disabled = tour.i === 0;
        back.style.display = tour.solo ? "none" : "";
        const guide = panel.querySelector('[data-action="guide"]');
        guide.textContent = tour.guided ? "I'll click myself" : "Guide me through it";
        guide.style.display = tour.solo ? "none" : "";
        panel.querySelector('[data-role="dots"]').innerHTML = tour.solo ? "" : tour.steps
            .map((_, n) => `<i${n === tour.i ? ' data-status="now"' : n < tour.i ? ' data-status="done"' : ""}></i>`).join("");
        // Shown by an attribute rather than by opacity: a panel faded to nothing
        // is still a panel, and it went on swallowing every click in that corner
        // of the screen after the tour was over.
        panel.dataset.open = "1";

        light();
        if (self) waitForClick(el);
        // …but a guided tour does not walk over its own wreckage: a step that
        // could not be done stops the clock, so somebody is there to see that the
        // app does not have what the tour says it has.
        if (tour.guided && !tour.stuck) startAuto(); else stopAuto();
        // A solo step is the guide's turn, not a sitting to come back to.
        if (!tour.solo) try { window.sessionStorage.setItem(KEEP, JSON.stringify({ ...tour, at: Date.now() })); } catch { /* a tour is not worth an error */ }
    }

    async function tourGo(delta) {
        if (!tour) return;
        const at = tour.i + delta;
        if (at >= tour.steps.length) return tourEnd({ finished: true });
        tour.i = Math.max(0, at);
        await enter();
    }

    // Arriving at a step: go where it is about, THEN say it.
    //
    // A step's sentence describes the screen it is about, so a step that opens
    // another page must open it first. It used to travel on the way out — press
    // Next and go — which meant the sentence for a page you had not reached yet
    // was read over the page you were still on: "the appointment queue, Omar has
    // sent his form" with a patient's own portal on the screen and her name
    // highlighted. Nonsense, and exactly the kind that makes a reader distrust
    // everything else the panel says. The button on the step BEFORE says where
    // pressing it goes ("Take me there →"), so nothing moves unannounced.
    async function enter() {
        const step = tourStep();
        tour.stuck = "";                 // a new step is not the last one's failure
        tour.how = null;                 // …nor did it end the way the last one did
        const d = typeof step?.open === "string" ? { url: step.open } : step?.open;
        if (d) {
            const there = d.url && location.pathname + location.search === d.url;
            try { if (!there) await (d.url ? window.page.go(d) : window.page.open(d)); }
            catch (error) { tourDraw(); return void say({ text: String(error?.message ?? error) }); }
        }
        tourDraw();
    }

    async function tourNext() {
        const step = tourStep();
        if (!step) return;
        stopWaiting();
        // Whether the timer ran out or somebody pressed the button, this step is
        // over — and a step whose act fails stays put below, where a bar still
        // filling would promise a move that is not coming.
        stopAuto();
        const go = panel.querySelector('[data-action="next"]');
        // A step that already failed is not retried: pressing again is how the
        // reader steps over it, which is the only way past a tour written about a
        // control this page does not have.
        if (tour.stuck) tour.how = "skipped";
        if (actOf(step) && !tour.stuck) {
            go.disabled = true;
            // A step whose act failed stays put and says why — walking on by
            // itself would leave somebody reading about a screen they never
            // reached, and in the guided mode nobody is there to notice.
            try { await perform(step); tour.how = "shown"; }
            catch (error) {
                go.disabled = false;
                tour.stuck = missing(error);
                // A failure is the guide's business more than anybody's: what was
                // looked for, on which page, said at the moment it happened.
                if (tour.solo) press({ pressed: "failed", say: step.say ?? "", stuck: tour.stuck });
                tourDraw();
                return;
            }
            go.disabled = false;
        }
        tour.how ??= "next";
        await tourGo(1);
    }

    function tourEnd(how = {}) {
        stopWaiting();
        stopAuto();
        const was = tour;
        tour = null;
        if (panel) delete panel.dataset.open;
        if (spot) spot.style.opacity = "0";
        try { window.sessionStorage.removeItem(KEEP); } catch { /* … */ }
        // A finished solo step hands the floor back: the press goes to whoever
        // guides. Being displaced by the guide's own next step is not a press.
        if (was?.solo && !how.displaced) {
            press({ pressed: how.finished ? (was.how ?? "next") : "stop", say: was.steps[0]?.say ?? "", ...(was.stuck ? { stuck: was.stuck } : {}) });
        }
        return how;
    }

    // ── the verbs ────────────────────────────────────────────────────────────
    window.page = {
        state,

        // Hand a scenario over and return: from here on the person taking the
        // tour is the one advancing it.
        async tour(opts) {
            const steps = (opts.steps ?? []).filter(s => s && (s.say || actOf(s)));
            if (!steps.length) throw new Error("a tour needs steps");
            // One tour alive: a new one displaces the old one WHOLE — including
            // its armed listeners and timers, or the old tour's waitForClick
            // keeps firing tourGo(1) at the new one's steps.
            tourEnd({ displaced: true });
            tour = { steps, i: 0, guided: opts.guided === true, title: opts.title ?? "" };
            await enter();
            // "" when the first step points at nothing by design (it opens a url,
            // or it is a sentence) — only a step that NAMES something the screen
            // does not have is worth reporting back.
            return { tour: steps.length, at: 0, on: !targetOf(steps[0]) ? "" : target(steps[0]) ? "screen" : "elsewhere" };
        },

        // One turn of a LIVE tour: say it, light it, return — and the person's
        // answer comes back as POST /screen/press, to whoever is guiding. No
        // promise is held open across the wire; guiding is turn-taking. The same
        // panel plays it, minus what only a scripted tour has: no count, no
        // dots, no Back, no guided mode.
        async step(opts) {
            if (!opts || (!opts.say && !actOf(opts) && !opts.point && !opts.open)) throw new Error("a step needs something to say or do");
            tourEnd({ displaced: true });
            tour = { steps: [opts], i: 0, guided: false, title: opts.title ?? "", solo: true };
            await enter();
            return { step: opts.say ?? "", on: !targetOf(opts) ? "" : target(opts) ? "screen" : "elsewhere" };
        },

        endTour: () => tourEnd({ ended: true }),
        find: d => { const el = find(d); return { tag: el.tagName.toLowerCase(), text: textOf(el).slice(0, 120) }; },

        async point(d) {
            const el = find(d);
            await moveTo(el, d);
            return { pointed: d, tag: el.tagName.toLowerCase(), text: textOf(el).slice(0, 120) };
        },

        say,

        async click(d) {
            const el = find(d);
            // A marker often sits on the row, not on what does the work — the
            // link or button lives inside. Clicking the container does nothing,
            // so press the interactive thing, the way `open` follows a row's own
            // link. The row is still what lights up: it is what the step names.
            const it = el.matches?.("a,button,[role=button],input,select,textarea,summary,label") ? el
                : el.querySelector?.("a[href],button,[role=button],input[type=submit],input[type=button]") ?? el;
            if (d.show !== false) { await moveTo(el, d); pulse(); }
            await settle(() => it.click());
            return { clicked: d, tag: it.tagName.toLowerCase(), href: it.getAttribute?.("href") ?? null };
        },

        // Follow an entity's own link rather than clicking it, so a row that is a
        // link and a row that merely contains one behave the same.
        async open(d) {
            const row = entity(d);
            const link = row.tagName === "A" ? row : row.querySelector("a[href]");
            if (!link) throw new Error("no link inside " + JSON.stringify(d));
            if (d.show !== false) { await moveTo(link, d); pulse(); }
            await settle(() => link.click());
            return { opened: link.getAttribute("href") };
        },

        async fill(d) {
            const scope = one(sel("form", d.form), "form");
            const filled = [], missing = [];
            for (const [name, value] of Object.entries(d.values)) {
                const controls = controlsFor(scope, name);
                if (!controls.length) { missing.push(name); continue; }
                const control = controls.length > 1 && controls[0].type === "radio"
                    ? controls.find(c => c.value === String(value)) ?? controls[0]
                    : controls[0];
                if (d.show !== false) await moveTo(control, { delay: 220, holdMs: 1600 });
                if (control.type === "checkbox" || control.type === "radio") control.checked = control.type === "radio" ? true : !!value;
                else control.value = String(value);
                control.dispatchEvent(new Event("input", { bubbles: true }));
                control.dispatchEvent(new Event("change", { bubbles: true }));
                filled.push(name);
            }
            // What the form holds NOW, re-read from the live DOM: a `change` can
            // trigger a swap that re-renders the form, and a fill it swallowed
            // must not look identical to one that took.
            const values = (() => {
                try {
                    const live = one(sel("form", d.form), "form");
                    return Object.fromEntries(Object.keys(d.values).map(name => {
                        const control = controlsFor(live, name)[0];
                        return [name, !control ? null : control.type === "checkbox" ? control.checked : control.value];
                    }));
                } catch { return null; }
            })();
            return { form: d.form, filled, missing, values, fields: missing.length ? fieldNames(scope) : undefined };
        },

        async submit(d) {
            const anchor = one(sel("form", d.form), "form");
            const form = anchor.tagName === "FORM" ? anchor : anchor.closest("form") ?? anchor.querySelector("form");
            if (!form) throw new Error("no <form> at " + sel("form", d.form));
            const button = form.querySelector("button[type=submit], [type=submit], button:not([type])");
            if (d.show !== false) { await moveTo(button ?? form, d); pulse(); }
            await settle(() => { if (button) button.click(); else form.requestSubmit(); });
            return { submitted: d.form };
        },

        // Navigation stays partial: htmx swaps the pane and pushes the URL, so
        // the chat, the event stream and this bridge survive. Never fall back to
        // location.assign(): that reloads the document and makes the chat blink.
        // Where this tab is, told to the server rather than asked for. The
        // workspace used to have to interrupt the person to find out — every
        // `readScreen` is a round trip through the event stream — and a chat
        // that starts with "where are you?" reads as a machine that is not
        // paying attention. One POST per settle, no answer wanted.
        here() {
            // Only when it CHANGED. This fires on every settle, and in a
            // workspace the chat streams — a swap a second, sometimes ten — so
            // an unconditional beacon turned a cheap fact into a flood that
            // filled the log and starved the process it was reporting to. The
            // url is the whole fact; if it is the same, nobody needs telling.
            const at = location.pathname + location.search;
            if (at === window.page._here) return;
            window.page._here = at;
            // Where this tab is no longer needs saying: the server records it
            // from the page requests the tab already makes (src/$middleware.ts).
            // Only what a request CANNOT show is still reported — the viewport,
            // and only when it changed, so idle tabs stay silent.
            try {
                const size = window.innerWidth + "x" + window.innerHeight;
                if (size === lastViewport) return;
                lastViewport = size;
                const json = JSON.stringify({
                    url: location.pathname + location.search,
                    title: document.title,
                    page: document.querySelector("[data-page]")?.dataset.page ?? null,
                    agentId: document.body?.dataset.agentId ?? null,
                    viewport: { width: window.innerWidth, height: window.innerHeight },
                });
                navigator.sendBeacon?.("/ui/state", new Blob([json], { type: "application/json" }));
            } catch { /* a tab that cannot say its size still works */ }
        },

        async go(d) {
            if (!window.htmx?.ajax) throw new Error("htmx is not ready");
            await settle(() => window.htmx.ajax("GET", d.url, { target: "#main", swap: "innerHTML" }));
            // htmx 2's ajax() has no push option — keep the address bar honest ourselves.
            try { history.pushState({}, "", d.url); } catch { /* sandboxed */ }
            return { opened: d.url };
        },
    };
    // …and say it: once on load, and after every swap, because navigation here
    // is partial and a swap is what a page change IS.
    window.page.here();
    document.addEventListener("htmx:after:swap", () => {
        window.page.here();
        // The page under the tour was swapped — by a step, or by the reader
        // wandering off. Either way the highlight belongs to whatever is there
        // now, and the panel says where that is.
        if (tour) tourDraw();
    });

    // A reload is not the end of a tour: the panel is the only place it lives,
    // so losing it would strand somebody in the middle of being shown around.
    try {
        const kept = JSON.parse(window.sessionStorage.getItem(KEEP) ?? "null");
        // Half an hour, not for ever. The crumb outlives reloads on purpose, and
        // it outlived a whole afternoon just as happily: a tour from another
        // sitting came back on every reload, saying something about a screen
        // nobody had been near since — and the only way out was to notice the
        // panel and close it.
        if (kept?.steps?.length && Date.now() - (kept.at ?? 0) < KEEP_FOR) { tour = kept; tourDraw(); }
        else if (kept) window.sessionStorage.removeItem(KEEP);
    } catch { /* a bad crumb is no tour */ }
})();
