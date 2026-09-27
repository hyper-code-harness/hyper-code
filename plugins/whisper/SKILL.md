---
name: whisper
description: "Local speech-to-text with whisper.cpp (Metal) — list downloaded ggml models, transcribe audio files or uploaded bytes with language and vocabulary prompt, and test from the /whisper page with the microphone."
---
# Whisper

Models live in `~/.local/share/whisper-cpp/ggml-<name>.bin`; binary `whisper-cli` (brew whisper-cpp).

```ts
await ctx.fns.whisper.models({});
await ctx.fns.whisper.transcribe({ path: "/tmp/a.wav", model: "large-v3-turbo", language: "ru", prompt: "procs.db.select, git" });
```

Any ffmpeg-readable format is accepted; it is converted to 16 kHz mono WAV first.
Test page: `/whisper` — record with the mic, compare models, see latency.
