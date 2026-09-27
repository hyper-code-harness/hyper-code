---
description: >-
  Find files by glob pattern, honouring .gitignore. Returns matching paths. Use this instead of
  shelling out to `find` — a walk over a home directory takes minutes and usually times out.
promptSnippet: "find files by glob (respects .gitignore)"
promptGuidelines:
  - "Look for files with find, not with bash `find` — it is faster and skips node_modules and build output."
parameters:
  type: object
  properties:
    host:
      type: string
      description: "SSH server alias from ~/.ssh/config (list: ctx.fns.remote.servers({})), or \"local\". Omit to act in the agent workspace — local, or remote when the workspace has a host. On the workspace host relative paths resolve against the workspace dir; on other hosts against the remote home."
    pattern:
      type: string
      description: "Glob, e.g. *.test.ts or src/**/*.md. A pattern without a slash matches at any depth."
    path:
      type: string
      description: "Directory to search under. Relative paths resolve against the workspace."
    limit:
      type: integer
      description: "Maximum paths to return (default 200). You are told when the limit is hit."
    noIgnore:
      type: boolean
      description: "Search everywhere, ignoring .gitignore — node_modules, build output, vendored code."
    hidden:
      type: boolean
      description: "Include dotfiles and dot-directories."
    timeout:
      type: integer
      description: "Seconds before the walk is cut short, returning what it found. No limit by default."
  required: [pattern]
  additionalProperties: false
---
