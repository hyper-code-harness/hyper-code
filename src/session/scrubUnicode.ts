/**
 * Replaces Unicode code units that PostgreSQL UTF-8 and jsonb cannot store safely
 *
 * Sanitizes text before persistence by replacing NUL and unpaired UTF-16 surrogate code units with the Unicode replacement character while preserving valid surrogate pairs. Use at every transcript JSON/text persistence boundary.
 * @param opts.text Text to make safe for PostgreSQL UTF-8 and jsonb storage.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Text to make safe for PostgreSQL UTF-8 and jsonb storage. */
        text: string;
    },
): Promise<string> {
    let out = "";
    for (let i = 0; i < opts.text.length; i++) {
        const code = opts.text.charCodeAt(i);
        if (code === 0) { out += "\uFFFD"; continue; }
        if (code >= 0xD800 && code <= 0xDBFF) {
            const next = opts.text.charCodeAt(i + 1);
            if (next >= 0xDC00 && next <= 0xDFFF) { out += opts.text.charAt(i) + opts.text.charAt(++i); continue; }
            out += "\uFFFD"; continue;
        }
        if (code >= 0xDC00 && code <= 0xDFFF) { out += "\uFFFD"; continue; }
        out += opts.text.charAt(i);
    }
    return out;
}
