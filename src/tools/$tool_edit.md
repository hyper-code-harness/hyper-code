---
description: >-
  Edit an existing file in place. `path` names the file, `edits` lists the changes. The usual
  edit is a literal replacement — oldText must appear exactly once unless all is set. Anchored
  edits address lines by the anchors a hashline read returns, and are refused if the anchor moved.
marker: edit
validate: tools.editValidate
promptSnippet: "edit files in place"
promptGuidelines:
  - "An edit replaces exact text, so copy oldText verbatim from what you read, including indentation, and give enough of it to be unique."
  - "Several changes to one file belong in one edit call with several entries in edits, not in several calls."
parameters:
  type: object
  properties:
    host:
      type: string
      description: "SSH server alias from ~/.ssh/config (list: ctx.fns.remote.servers({})), or \"local\". Omit to act in the agent workspace — local, or remote when the workspace has a host. On the workspace host relative paths resolve against the workspace dir; on other hosts against the remote home."
    path:
      type: string
      description: "File to edit."
    edits:
      type: array
      description: "Changes to apply. Each is matched against the file as it stands, not against the result of the previous one."
      items:
        type: object
        properties:
          op:
            type: string
            enum: [replace, replaceLines, insertBefore, insertAfter, delete]
            description: "Defaults to replace when oldText is given."
          oldText:
            type: string
            description: "op=replace — exact text to find. Must match once unless all is true."
          newText:
            type: string
            description: "op=replace — text to put in its place. Empty string deletes it."
          all:
            type: boolean
            description: "op=replace — replace every occurrence instead of requiring exactly one."
          anchor:
            type: string
            description: "Anchored ops — the anchor from a hashline read. BOF/EOF work for inserts."
          endAnchor:
            type: string
            description: "Anchored ops — last anchor of the range, for replaceLines and delete."
          text:
            type: string
            description: "Anchored ops — the replacement or inserted lines."
        additionalProperties: false
  required: [path, edits]
  additionalProperties: false
---
### `§edit` / `§edit:hashline`

The marker form takes the anchored script as its body — it is translated into the same
structured edits the tool takes. `§edit` is shorthand for `§edit:hashline`.

Rules:
- Read the file first with `§read:hashline`.
- Copy anchors exactly.
- The first non-blank line must be `@PATH`.
- Payload lines must start with `|`.

Ops:
- `+ ANCHOR` — insert after anchor
- `< ANCHOR` — insert before anchor
- `- A..B` — delete range
- `= A..B` — replace range
- `= A` — replace one line
- `replace "old" "new"` — literal replacement; requires exactly one match
- `replace-all "old" "new"` — replace every literal match; requires at least one
- Replace arguments are JSON strings, so use `\n`, `\"`, and `\\` escapes as needed.

Example body:
    @src/foo.ts
    = 22ab
    |const x = 1;

Result:
    §result:edit:hashline
    edited src/foo.ts (123 bytes)
