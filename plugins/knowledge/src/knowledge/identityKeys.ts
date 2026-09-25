// Turns the contact fields of an entity record into canonical identity keys.
//
// The same account is written down many ways: a LinkedIn profile appears as
// `https://www.linkedin.com/in/x/`, `https://fi.linkedin.com/in/x` and
// `linkedin.com/in/X`; a Telegram handle as `@x`, `x` or `https://t.me/x`; a
// GitHub account as a handle or a URL. Comparing the raw strings therefore
// misses most real matches, which is how one person ended up as three records.
//
// A key is emitted only when the value identifies an account. Free text such as
// "back office" in a linkedin field, invite links like `t.me/+AbCd`, and group
// mailboxes are rejected: a wrong key silently merges two different people,
// which is far worse than a missed duplicate.

/** Extracts canonical identity keys such as linkedin:handle from an entity's contact fields. */
/**
 * Normalize the contact fields of one entity record into comparable identity keys.
 *
 * Use before writing an entity, to find an existing record that already owns the
 * same account, and in deduplication to compare two records by identity rather
 * than by name. Keys are returned as `source:value` strings, lowercased, with
 * URL wrappers, country subdomains and decorations removed.
 *
 * Values that do not identify an individual account produce no key, so an empty
 * result means "no reliable identity", not "no contact data".
 *
 * @param opts.data Entity data object whose contact fields are read.
 * @param opts.includePhone Also emit phone keys; off by default because numbers are shared.
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** Entity `data` object; unknown and empty fields are ignored. */
    data: Record<string, any>;
    /** Emit `phone:` keys as well. @default false */
    includePhone?: boolean;
}): string[] {
    const data = opts.data ?? {};
    const keys = new Set<string>();
    const add = (source: string, value: string | null) => { if (value) keys.add(`${source}:${value}`); };

    for (const value of values(data.linkedin)) add("linkedin", linkedin(value));
    for (const value of values(data.telegram)) add("telegram", handle(value, "t.me"));
    for (const value of values(data.github)) add("github", handle(value, "github.com"));
    for (const field of ["email", "work_email", "personal_email", "additional_emails"]) {
        for (const value of values(data[field])) add("email", email(value));
    }
    // Phone numbers are shared between spouses, assistants and office desks:
    // two people in this very graph sit on one Lisbon landline. Useful as a
    // hint, never as an identity, so they are opt-in.
    if (opts.includePhone === true) {
        for (const value of values(data.phone)) add("phone", phone(value));
    }

    return [...keys];
}

function values(input: any): string[] {
    if (input == null) return [];
    return (Array.isArray(input) ? input : [input])
        .map((item) => String(item ?? "").trim())
        .filter(Boolean);
}

// linkedin.com/in/<handle>, whatever the country subdomain or trailing slash.
// A bare handle is accepted too, but only when it cannot be a sentence.
function linkedin(raw: string): string | null {
    const url = /(?:^|\/\/)(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([^/?#\s]+)/i.exec(raw);
    if (url) return decodeURIComponent(url[1]!).toLowerCase();
    if (/linkedin\.com/i.test(raw)) return null; // company or post URL, not a person
    return /^[a-z0-9][a-z0-9-]{2,}$/i.test(raw) ? raw.toLowerCase() : null;
}

// @handle, handle, or https://<host>/handle. Invite links carry a `+` and
// identify a chat rather than a person.
function handle(raw: string, host: string): string | null {
    const escaped = host.replace(/\./g, "\\.");
    const url = new RegExp(`(?:^|//)(?:www\\.)?${escaped}/([^/?#\\s]+)`, "i").exec(raw);
    const candidate = url ? url[1]! : raw.replace(/^@/, "").trim();
    if (!candidate || candidate.startsWith("+")) return null;
    return /^[a-z0-9_-]{3,}$/i.test(candidate) ? candidate.toLowerCase() : null;
}

function email(raw: string): string | null {
    const match = /^[^\s<>@]+@[^\s<>@.]+\.[^\s<>@]+$/.exec(raw.replace(/^mailto:/i, "").trim());
    return match ? match[0].toLowerCase() : null;
}

// Digits only, with the Russian 8-prefix folded onto +7 so the same number
// written either way collides.
function phone(raw: string): string | null {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) return null;
    return digits.length === 11 && digits.startsWith("8") ? `7${digits.slice(1)}` : digits;
}
