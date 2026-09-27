---
description: >-
  Create or overwrite a file with exactly this content. Use for new files and full rewrites;
  use edit for targeted changes to an existing file.
marker: write
promptSnippet: "create files or rewrite them whole"
parameters:
  type: object
  properties:
    host:
      type: string
      description: "Remote SSH server alias from ~/.ssh/config (list: ctx.fns.remote.servers({})). Omit to act locally. With host, path is remote; relative paths resolve against the remote home."
    path:
      type: string
      description: "File path to write."
    content:
      type: string
      description: "Full file body, written verbatim."
  required: [path, content]
  additionalProperties: false
---
### `§write:<path>`

- Writes the body verbatim to the target path.
- For .ts/.js files the result warns you if the written file does not parse —
  treat that as "I forgot the closing §" and fix the file immediately.
