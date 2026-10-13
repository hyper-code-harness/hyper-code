# Nano Banana

Generate and edit marketing images with Gemini Nano Banana 2.1 through Vertex AI in the dedicated `hs-hyper-code` Google Cloud project.

## Use it

- Generate: `nanobanana.generate({ prompt: "...", out: "artifacts/ad.png" })`
- Edit: pass one or more local reference images in `images`. Describe the exact change and what must remain unchanged.
- Choose `aspectRatio` for the placement and `resolution` for cost/quality. Default is 1K.
- The function returns paths and actual response metadata; it never returns large base64 payloads.

## Marketing workflow

1. Start at 1K and ask for 2–4 variants with separate calls.
2. Pick one output, then pass it back in `images` for conversational editing.
3. Use explicit brand colors, exact copy in quotes, placement, audience and channel dimensions in the prompt.
4. Move to 2K or 4K only for the selected final.

## Cost

Published image-output prices for Nano Banana 2.1 are approximately $0.0336 at 1K, $0.0504 at 2K and $0.113 at 4K per image. Input tokens and Search grounding can add cost. Google billing remains authoritative.

## Authentication

Uses only a dedicated service-account JSON key stored in encrypted local secret storage as `secret://nanobanana/serviceAccountKey` — never the ambient `gcloud`/ADC identity. Give that service account nothing but `aiplatform.endpoints.predict` in the billed project (in `hs-hyper-code`: custom role `nanobananaPredict`, account `nanobanana-marketing@hs-hyper-code.iam.gserviceaccount.com`). Store the key with `secrets.set({ ref: "secret://nanobanana/serviceAccountKey", value })` or a `secret` chat input; the plugin mints short-lived tokens from it and caches them in memory. The project is intentionally fixed to `hs-hyper-code` unless explicitly overridden.
