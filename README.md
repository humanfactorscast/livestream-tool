# Livestream Copilot Sidecar

A lightweight, browser-based tool to support live podcast hosting with three AI-style agents:

1. **Strategist (Whisperer)** – proposes proactive, host-ready questions from a rolling transcript window.
2. **Researcher (Human Factors)** – surfaces behavioral/cognitive context using fast concept extraction + quick source lookups.
3. **Scribe** – captures transcript snippets and auto-highlights entities/key concepts.

## Why this is practical for live use

- Uses a **rolling 60–90 second context window** to stay relevant and keep latency low.
- Agent suggestions are shown to the **host UI** (not spoken directly to guests), preserving natural flow.
- Works with **optional OpenAI API key** for stronger generation, with local fallback logic when no key is set.
- Includes a **Broadcast Simulation** mode so you can test behavior before going live.

## Quick start

```bash
python3 -m http.server 4173
```

Then open: `http://localhost:4173`

> Best experience: Chrome or Edge (SpeechRecognition support).

## How to use during a livestream

1. Open the app on a side monitor.
2. (Optional) add your OpenAI API key for better question generation.
3. Click **Start Listening**.
4. Keep an eye on:
   - **Strategist** panel for host questions.
   - **Researcher** panel for context/facts.
   - **Scribe** panel for names/concepts to reference later.
5. Use **Generate Question Now** or **Research Current Context** when conversation pivots quickly.

## Architecture notes

- **Input layer**: Browser SpeechRecognition streams transcript text.
- **Agent 1** trigger: interval (45s) + pause detection (~4.5s).
- **Agent 2** trigger: manual or simulation; can be automated further.
- **Agent 3** trigger: every transcript entry.

## Production extension ideas

- Replace browser speech recognition with Deepgram or Whisper streaming backend.
- Add speaker diarization and confidence scoring.
- Add RAG over curated papers/books for richer human factors references.
- Persist sessions and export timestamped show notes.
