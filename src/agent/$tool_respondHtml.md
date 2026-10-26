---
description: >-
  Finish the current turn with programmatically generated HTML. Use only when a tool/eval has
  produced the complete user-facing answer and no further model explanation is needed. The runtime
  stores this tool result first, sanitizes the HTML, appends the final assistant message/event, and
  stops without another LLM call.
promptSnippet: "finish the turn with a sanitized HTML response visible to the user"
promptGuidelines:
  - "Answer in plain markdown. respondHtml only when the answer really needs HTML (a table, a layout): it is the last call of the turn, alone, with no prose beside it, and it costs the answer twice (html + text)."
parameters:
  type: object
  properties:
    html:
      type: string
      description: Complete HTML fragment to display. Do not include html/head/body, scripts, styles, or event handlers.
    text:
      type: string
      description: Plain-text fallback and durable assistant-message content for history and future LLM context.
  required: [html, text]
  additionalProperties: false
---
### Terminal HTML response

Call this only after gathering all required data. It is a terminal operation, not an HTML renderer:

```json
{"html":"<section><h2>Result</h2><p>Done.</p></section>","text":"Result: Done."}
```

The function itself has no transcript side effects. `agent.run` first writes the corresponding tool
result, then sanitizes the payload with `agent.sanitizeHtmlBody`, appends one final assistant message
using `text`, appends its UI event using the sanitized HTML, and ends the turn. This ordering preserves
a valid native-tool transcript and prevents a duplicate model-generated final response.
