---
description: >-
  Read a file, optionally a line range. With hashline the lines come back prefixed with stable
  anchors — read that way when you intend to edit the file afterwards. An image path (.png, .jpg,
  .jpeg, .gif, .webp) returns the picture itself, so you can look at screenshots.
marker: read
promptSnippet: "read files, whole or by line range"
promptGuidelines:
  - "Read a file in hashline mode before editing it — an edit addresses anchors, not line numbers."
  - "To look at a screenshot or any image, read its path: the image is attached to the result and you see it."
parameters:
  type: object
  properties:
    path:
      type: string
      description: "File path, relative to the workspace or absolute."
    startLine:
      type: integer
      description: "First line to return (1-based)."
    endLine:
      type: integer
      description: "Last line to return, inclusive."
    maxLines:
      type: integer
      description: "Cap on the number of lines returned."
    hashline:
      type: boolean
      description: "Return anchored lines, ready for edit."
  required: [path]
  additionalProperties: false
---
### `§read`

Two body forms are supported.

Shorthand body:
    src/foo.ts

Structured body:
    path: src/foo.ts
    startLine: 120
    endLine: 180

or:
    path: src/foo.ts
    maxLines: 80

Structured keys:
- `path` — required
- `startLine` — optional, 1-based
- `endLine` — optional, inclusive
- `maxLines` — optional cap on returned lines

Rules:
- If the body is a single line with no `:`, it is treated as the path shorthand.
- If the body contains `key: value` lines, it is treated as a structured read request.
- For plain `§read`, line options return only that slice as plain text.
- Any unknown key is an error, so a typo surfaces instead of becoming part of the path.

Result:
    §result:read:src/foo.ts
    ...raw file text...

If you use a structured body, the result header echoes the original body verbatim after `§result:read:`.

### `§read:hashline`

Same body rules. Result rows carry an anchor per line:

    §result:read:hashline:src/foo.ts
    11a|first line
    22b|second line

Use this before `§edit` — the anchors are what an edit addresses.
