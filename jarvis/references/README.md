# Visual reference notes

User-supplied TikTok clips (`jarvis_tiktok_1.mp4`, `jarvis_tiktok_2.mp4`) are kept **locally only**
(`*.mp4` is git-ignored); the two contact sheets are committed. To re-add the videos, copy them here.

Frames were extracted with `ffmpeg` and inspected (contact sheets + close-up crops at 12 s / 26 s).

## Observations (what the HUD implements)
- **Video 2 (the target look):** full-screen very dark teal/navy field with a soft teal haze that is
  brightest around the centre. A single **intensely bright white-cyan core**, with a wide bloom.
- Around the core: a **ring of fine radial tick marks** (the dominant element) between two thin circles,
  then thin arc segments, then a **dotted circle**, then a loose **cloud of small particles** that thins
  out with distance — symmetric, delicate, low contrast.
- Peripheral UI is minimal: a tiny letter-spaced **"JARVIS"** title at the top centre, a tiny status word
  ("…TENING" ≈ LISTENING) top-left, and a small text-entry hint bottom-left.
- **Video 1** shows a busier dashboard on an ultrawide monitor (side panels with lists/metrics around a
  central circular emblem) and narrated claims (follower counts, lights). Those integrations are *not*
  evidence of working features; we only implement verifiable ones.
- The clips also *mention* Fish Audio for the voice and Groq for the LLM; here Ollama is the default
  and Groq is optional.

## Mapping to the implementation
| Reference element | Implementation (`frontend/src/hud/orbRenderer.ts`) |
|---|---|
| white-cyan core + bloom | layered radial gradients, breathing in IDLE, scaled by real audio level |
| radial tick ring | 90 ticks, every 5th long, slow rotation |
| thin circles / arcs | inner/outer circles + three counter-rotating 77° arcs, dashed ring |
| dotted circle | 140 dots, every 10th larger |
| particle cloud | 260 seeded particles, density falls off outward, slow drift + twinkle |
| small corner text | brand + state top-left, live status top-right, real CPU/RAM/GPU bottom-left |
