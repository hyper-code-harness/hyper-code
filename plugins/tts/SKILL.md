---
name: tts
description: "Text-to-speech: narrate text or markdown into an audio file, voice a multi-speaker dialogue, and list available voices. Defaults to Gemini TTS for expressive delivery; classic Google Cloud Chirp voices remain available."
---

# tts

Two backends behind one entry point.

- **gemini** (default) — Gemini TTS models. Expressive, takes a plain-prose style
  instruction, renders long text in a single pass, reports duration and cost.
  Needs a Gemini API key in `secret://tts/gemini_api_key`.
- **google** — classic Google Cloud Chirp voices. OAuth client and refresh token stay
  in 1Password, access tokens cached in memory only. Long text is chunked by sentence
  and joined with the installed `ffmpeg`.

The default is the `tts.engine` setting (`gemini` | `google`, env `TTS_ENGINE`).
Pass `engine` explicitly to override per call.

## Functions

- `tts.speak({ text, out?, engine?, style?, model?, voice?, lang?, speed?, pitch?, format?, strip? })`
  - routes to the configured engine; returns `{ saved, chunks, engine, seconds, cents, model }`;
  - `style`, `model` apply to gemini; `lang`, `speed`, `pitch`, `format` apply to google.
- `tts.gemini({ text | lines + cast, out?, voice?, model?, style?, temperature?, strip? })`
  - the full Gemini surface, including multi-speaker dialogue;
  - returns `{ saved, bytes, mimeType, model, speakers, seconds, audioTokens, cents, usage }`.
- `tts.voices({ lang? })` — Google Cloud voice catalogue.

```ts
await ctx.fns.tts.speak({ text: "Привет!", out: "/tmp/hello.wav" });
await ctx.fns.tts.speak({ text: "Привет!", engine: "google", out: "/tmp/hello.ogg" });

await ctx.fns.tts.gemini({
  cast: [{ speaker: "Анна", voice: "Kore" }, { speaker: "Максим", voice: "Puck" }],
  lines: [
    { speaker: "Анна",   style: "warm news anchor", text: "…" },
    { speaker: "Максим", style: "wry",              text: "…" },
  ],
  out: "/tmp/digest.wav",
});
```

## Gemini notes

Multi-speaker requests need one content part per line tagged with
`speechMetadata.speaker`; a single script blob returns 400. At most two speakers per
request. Output is 24 kHz mono; raw PCM is wrapped in a WAV header automatically.
Flash costs roughly 2.3 ¢ per minute of audio, Flash-Lite about half that.
