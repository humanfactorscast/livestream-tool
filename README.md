# Livestream Copilot Sidecar

A lightweight, browser-based tool to support live podcast hosting with automatic alternating prompts.

The setup controls now live behind a hamburger-style **Setup** drawer, so the main screen stays focused on transcript + live prompt output during broadcast.

## New: URL context sources (up to 10)

You can now provide up to **10 URLs** (one per line) in the dashboard.

The app will:

1. Fetch readable content for each URL.
2. Build lightweight keyword context from those sources.
3. Use that context to improve alternating outputs:
   - sharper host questions,
   - context/amplification notes,
   - clarification prompts tied to your prep material.

Use **Load URL Context** after pasting links.

## What you see while live

- **Live Transcript** panel for the mixed stream transcript.
- **Live Prompt Feed (Host View)** panel for only surfaced host-ready outputs.

The prompt feed alternates automatically every ~2 minutes:

1. **Strategic Question**
2. **Research Context**
3. Repeat

## Audio capture

- Supports **local microphone audio** + **system/share audio**.
- Captures both streams, mixes them in-browser, and transcribes chunks with OpenAI transcription.

## Quick start

```bash
python3 -m http.server 4173
```

Then open: `http://localhost:4173`

> Best experience: Chrome or Edge.

## Livestream flow

1. Open app and add OpenAI API key.
2. Paste up to 10 URLs and click **Load URL Context**.
3. Keep both source checkboxes enabled (or choose one source).
4. Click **Start Listening**.
5. In browser share dialog, enable tab/window audio.
6. Watch the alternating prompt feed for guidance.

## Notes

- URL loading can fail for some pages depending on site protections.
- If no source context matches yet, prompts still run from transcript context.
- Simulation mode demonstrates the alternating flow quickly for UX checks.
