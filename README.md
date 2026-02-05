# Livestream Copilot Sidecar

A lightweight, browser-based tool to support live podcast hosting with automatic alternating prompts.

The setup controls now live behind a hamburger-style **Setup** drawer, so the main screen stays focused on transcript + live prompt output during broadcast.

## No-key local mode (lightweight)

You can run the app **without an OpenAI key**.

When no key is provided, the app uses:

- browser-native speech recognition for microphone transcription,
- local heuristic generation for question/research output,
- loaded URL context snippets for lightweight grounding.

This keeps resource usage low and avoids running heavyweight local models.

> Tradeoff: no-key mode transcribes microphone input only. Mixed system+mic transcription still requires an API-backed transcription path.
> In mixed-audio mode, shared system audio is also routed back to local output so you can still hear it while streaming.

## Easiest way to run locally

### Option A (recommended): one command

```bash
python3 launcher.py
```

### Option B: direct static server

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Build a single executable

```bash
./build_executable.sh
```

Output binary:

- `dist/livestream-copilot` (Linux/macOS)
- `dist/livestream-copilot.exe` (Windows, when built on Windows)

> Note: build on the same OS you plan to run on.

## URL context sources (up to 10)

Provide up to **10 URLs** (one per line) in the setup drawer, then click **Load URL Context**.

The app fetches readable content and uses it to enrich alternating host prompts.

## What you see while live

- **Live Transcript** panel.
- **Live Prompt Feed (Host View)** panel.

Alternation every ~2 minutes:

1. **Strategic Question**
2. **Research Context**
3. Repeat

## Notes

- URL loading can fail on sites with strict protections.
- Simulation mode demonstrates the alternating flow quickly.
