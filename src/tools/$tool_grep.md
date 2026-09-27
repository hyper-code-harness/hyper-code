---
description: >-
  Search file contents. Returns ripgrep-style rows — "path:line:column: text", context lines as
  "path-line- text". Respects .gitignore and skips binaries. With hashline the line number is
  replaced by a stable anchor, ready to use with edit. path may be a directory or a single file.
marker: grep
promptSnippet: "search file contents (respects .gitignore)"
promptGuidelines:
  - "Search in hashline mode when you want anchors from the search results to edit with."
  - "Use literal:true to search for text that contains regex characters instead of escaping them."
parameters:
  type: object
  properties:
    host:
      type: string
      description: "SSH server alias from ~/.ssh/config (list: ctx.fns.remote.servers({})), or \"local\". Omit to act in the agent workspace — local, or remote when the workspace has a host. On the workspace host relative paths resolve against the workspace dir; on other hosts against the remote home."
    pattern:
      type: string
      description: "Regular expression, or a plain string when literal is true."
    path:
      type: string
      description: "Directory OR a single file to search. Relative paths resolve against the workspace; defaults to the whole workspace."
    glob:
      type: string
      description: "Filter files by glob, e.g. **/*.ts"
    literal:
      type: boolean
      description: "Treat pattern as literal text instead of a regex (default false)."
    ignoreCase:
      type: boolean
      description: "Case-insensitive search (default false — searches are case-sensitive)."
    context:
      type: integer
      description: "Lines of context to include before and after each match."
    limit:
      type: integer
      description: "Maximum matches to return (default 50). You are told when the limit is hit."
    noIgnore:
      type: boolean
      description: "Search everywhere, ignoring .gitignore — node_modules, build output, vendored code."
    hidden:
      type: boolean
      description: "Include dotfiles and dot-directories."
    timeout:
      type: integer
      description: "Seconds before the search is cut short, returning what it found so far."
    hashline:
      type: boolean
      description: "Return anchors instead of line numbers, ready for edit."
  required: [pattern]
  additionalProperties: false
---
### `§grep`

Body is key/value lines:
    pattern: normalizeUser
    path: src
    glob: **/*.ts
    limit: 20
    ignoreCase: true

Supported keys: `pattern` (required), `path`, `glob`, `literal`, `ignoreCase`, `context`,
`limit`, `noIgnore`, `hidden`.

Result rows:
    §result:grep
    src/x.ts:12:5: matched line text

### `§grep:hashline`

Same request shape; the rows carry anchors instead of line numbers:

    §result:grep:hashline
    src/x.ts:12ab:5: matched line text

Useful when you want searchable anchors for later editing.
