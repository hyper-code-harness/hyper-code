---
description: >-
  Find or load an installed Agent Skill — a ready procedure for one kind of work (a review method, a
  test-first workflow, a document recipe). With query: returns the installed skills that match, with
  descriptions. With name: loads that skill's instructions as a <skill_content> block to follow.
  With name and file: reads one file from a loaded skill's folder. Searches installed skills only.
fn: skills.use
optIn: true
inlineLimit: 40000
promptSnippet: "find or load an Agent Skill (a ready procedure for a task)"
parameters:
  type: object
  properties:
    name:
      type: string
      description: "Skill to load: short name (tdd) or full (pack:tdd), as a search returned it or the person said it."
    query:
      type: string
      description: "What a skill should help with, in a few words — searches instead of loading."
    file:
      type: string
      description: "With name: relative path of a file inside the loaded skill's folder to read instead of the instructions, e.g. tests.md or references/forms.md."
    offset:
      type: integer
      description: "Character offset to continue a long text from (the previous answer says which)."
  additionalProperties: false
---
