const transcriptEl = document.getElementById('transcript');
const statusEl = document.getElementById('status');
const liveOutputEl = document.getElementById('liveOutput');
const sourcesStatusEl = document.getElementById('sourcesStatus');
const template = document.getElementById('itemTemplate');

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const clearBtn = document.getElementById('clearBtn');
const simulateBtn = document.getElementById('simulateBtn');
const loadSourcesBtn = document.getElementById('loadSourcesBtn');
const setupToggleBtn = document.getElementById('setupToggle');
const closeSetupBtn = document.getElementById('closeSetupBtn');
const setupDrawerEl = document.getElementById('setupDrawer');

const apiKeyInput = document.getElementById('apiKey');
const topicHintInput = document.getElementById('topicHint');
const sourceUrlsInput = document.getElementById('sourceUrls');
const useMicInput = document.getElementById('useMic');
const useSystemAudioInput = document.getElementById('useSystemAudio');

const AUTO_INTERVAL_MS = 120000;
const MAX_SOURCES = 10;


function setSetupDrawer(open) {
  setupDrawerEl.classList.toggle('open', open);
  setupDrawerEl.setAttribute('aria-hidden', open ? 'false' : 'true');
  setupToggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

const state = {
  listening: false,
  entries: [],
  micStream: null,
  systemStream: null,
  mixedStream: null,
  recorder: null,
  audioContext: null,
  automationTimer: null,
  nextAutoAction: 'question',
  sourceDocs: [],
};

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? 'var(--danger)' : 'var(--accent-2)';
}

function setSourcesStatus(text, isError = false) {
  sourcesStatusEl.textContent = text;
  sourcesStatusEl.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function appendListItem(container, text, cssClass = '') {
  const clone = template.content.cloneNode(true);
  clone.querySelector('time').textContent = new Date().toLocaleTimeString();
  const p = clone.querySelector('p');
  p.textContent = text;
  if (cssClass) p.classList.add(cssClass);
  container.prepend(clone);
}

function addLiveOutput(kind, text) {
  const prefix = kind === 'question' ? 'Question' : 'Research';
  appendListItem(liveOutputEl, `${prefix}: ${text}`, kind === 'research' ? 'fact' : 'question');
}

function addTranscript(text, speaker = 'Live') {
  const entry = { text, speaker, ts: Date.now() };
  state.entries.push(entry);
  const line = document.createElement('p');
  line.className = 'transcript-line';
  line.innerHTML = `<strong>${speaker}:</strong> ${escapeHtml(text)}`;
  transcriptEl.appendChild(line);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function getRollingWindow(seconds = 60) {
  const cutoff = Date.now() - seconds * 1000;
  return state.entries.filter((e) => e.ts >= cutoff).map((e) => `${e.speaker}: ${e.text}`).join('\n');
}

function parseSourceUrls(rawText) {
  const urls = rawText
    .split('\n')
    .map((u) => u.trim())
    .filter(Boolean)
    .map((u) => (u.match(/^https?:\/\//i) ? u : `https://${u}`));

  return [...new Set(urls)].slice(0, MAX_SOURCES);
}

function extractKeywords(text) {
  return [...new Set([...text.toLowerCase().matchAll(/\b(remote work|productivity|burnout|cognitive load|attention|stress|habit|motivation|leadership|team|trust|policy|ai|automation|culture|performance|focus|fatigue|wellbeing)\b/g)].map((m) => m[0]))];
}

function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/\[[^\]]+\]\([^\)]+\)/g, ' ')
    .replace(/[>#*_~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchSourceText(url) {
  const stripped = url.replace(/^https?:\/\//i, '');
  const proxyUrl = `https://r.jina.ai/http://${stripped}`;

  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error(`Unable to fetch (${res.status})`);

  const text = await res.text();
  const clean = stripMarkdown(text).slice(0, 12000);
  if (!clean) throw new Error('No readable content found');
  return clean;
}

async function loadSourceContext() {
  const urls = parseSourceUrls(sourceUrlsInput.value);
  if (!urls.length) {
    state.sourceDocs = [];
    setSourcesStatus('No sources loaded');
    return;
  }

  setSourcesStatus('Loading URL context…');
  const loaded = [];

  for (const url of urls) {
    try {
      const text = await fetchSourceText(url);
      loaded.push({
        url,
        text,
        keywords: extractKeywords(text),
      });
    } catch {
      // skip failed source
    }
  }

  state.sourceDocs = loaded;
  if (!loaded.length) {
    setSourcesStatus('Could not load any URLs (check URL format or content access).', true);
    return;
  }

  setSourcesStatus(`Loaded ${loaded.length}/${urls.length} URLs for context`);
}

function getSourceContextSnippet(windowText) {
  if (!state.sourceDocs.length) return '';

  const windowKeywords = extractKeywords(windowText);
  const scored = state.sourceDocs
    .map((doc) => {
      const overlap = doc.keywords.filter((k) => windowKeywords.includes(k)).length;
      return { doc, overlap };
    })
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 2)
    .map(({ doc, overlap }) => {
      const summary = doc.text.slice(0, 400);
      return `Source (${overlap} overlap): ${doc.url}\n${summary}`;
    });

  return scored.join('\n\n');
}

async function callOpenAI(systemPrompt, userPrompt) {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) return null;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`OpenAI request failed (${res.status}): ${detail.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

async function transcribeChunk(audioBlob) {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) return null;

  const form = new FormData();
  form.append('model', 'whisper-1');
  form.append('language', 'en');
  form.append('response_format', 'json');
  form.append('file', audioBlob, `mixed-${Date.now()}.webm`);

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Transcription failed (${res.status}): ${detail.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.text?.trim() || null;
}

function fallbackQuestion(windowText, sourceHint = '') {
  const lastSentence = windowText.split(/[\n.?!]/).map((s) => s.trim()).filter(Boolean).at(-1) || 'that point';
  const sourcePrompt = sourceHint ? ' How does that compare to the source material you loaded?' : '';
  return `What assumption is hiding inside "${lastSentence.slice(0, 80)}", and what evidence would change your mind?${sourcePrompt}`;
}

async function generateStrategistQuestion(reason = 'automation') {
  const windowText = getRollingWindow(60);
  if (!windowText) return;

  const sourceContext = getSourceContextSnippet(windowText);
  const systemPrompt = 'You are an expert podcast co-host. Create one concise, provocative follow-up question. If source context is provided, use it to sharpen clarity or challenge assumptions. Return only one question.';
  const userPrompt = `Reason: ${reason}\nTopic hint: ${topicHintInput.value.trim() || 'none'}\nTranscript:\n${windowText}\n\nOptional source context:\n${sourceContext || 'none'}`;

  try {
    const aiQuestion = await callOpenAI(systemPrompt, userPrompt);
    addLiveOutput('question', aiQuestion || fallbackQuestion(windowText, sourceContext));
  } catch (err) {
    addLiveOutput('question', `${fallbackQuestion(windowText, sourceContext)} (fallback: ${err.message})`);
  }
}

async function conductResearch(reason = 'automation') {
  const windowText = getRollingWindow(90);
  if (!windowText) return;

  const sourceContext = getSourceContextSnippet(windowText);
  const concepts = extractKeywords(windowText);

  const fallback = sourceContext
    ? `Source-backed angle: ${sourceContext.slice(0, 260)}...`
    : `No source match yet. Focus angle: ${concepts[0] || 'current claim'} and ask for concrete evidence.`;

  try {
    const ai = await callOpenAI(
      'You are a human factors research assistant. Give one short, concrete context note for live discussion. Prioritize loaded sources when relevant and explain why it matters.',
      `Reason: ${reason}\nConcepts: ${concepts.join(', ') || 'none'}\nTranscript:\n${windowText}\n\nOptional source context:\n${sourceContext || 'none'}`,
    );
    addLiveOutput('research', ai || fallback);
  } catch {
    addLiveOutput('research', fallback);
  }
}

async function runAlternatingAutomation() {
  if (state.nextAutoAction === 'question') {
    await generateStrategistQuestion('alternating-2m');
    state.nextAutoAction = 'research';
  } else {
    await conductResearch('alternating-2m');
    state.nextAutoAction = 'question';
  }
}

function startAutomationScheduler() {
  clearInterval(state.automationTimer);
  state.nextAutoAction = 'question';
  state.automationTimer = setInterval(() => runAlternatingAutomation(), AUTO_INTERVAL_MS);
}

function stopAutomationScheduler() {
  clearInterval(state.automationTimer);
  state.automationTimer = null;
}

async function requestInputStreams() {
  const useMic = useMicInput.checked;
  const useSystem = useSystemAudioInput.checked;

  if (!useMic && !useSystem) throw new Error('Enable at least one audio source (microphone or system audio).');

  let micStream = null;
  let systemStream = null;

  if (useMic) {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  }

  if (useSystem) {
    systemStream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });

    if (!systemStream.getAudioTracks().length) {
      systemStream.getTracks().forEach((t) => t.stop());
      throw new Error('System audio was not shared. Re-try and enable tab/window audio in the share dialog.');
    }

    systemStream.getVideoTracks().forEach((track) => {
      track.onended = () => stopListening();
    });
  }

  return { micStream, systemStream };
}

function mixAudioStreams(streams) {
  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();

  streams.filter(Boolean).forEach((stream) => {
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(destination);
  });

  return { mixedStream: destination.stream, audioContext };
}

async function startListening() {
  if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.getDisplayMedia) {
    setStatus('This browser does not support required media capture APIs.', true);
    return;
  }
  if (!window.MediaRecorder) {
    setStatus('MediaRecorder API unavailable. Use modern Chrome/Edge.', true);
    return;
  }
  if (!apiKeyInput.value.trim()) {
    setStatus('OpenAI API key required for dual-source transcription.', true);
    return;
  }

  try {
    if (sourceUrlsInput.value.trim() && !state.sourceDocs.length) {
      await loadSourceContext();
    }

    setStatus('Requesting microphone/system audio permissions…');
    const { micStream, systemStream } = await requestInputStreams();
    const { mixedStream, audioContext } = mixAudioStreams([micStream, systemStream]);

    state.micStream = micStream;
    state.systemStream = systemStream;
    state.mixedStream = mixedStream;
    state.audioContext = audioContext;

    const recorder = new MediaRecorder(mixedStream, { mimeType: 'audio/webm;codecs=opus' });
    state.recorder = recorder;

    recorder.ondataavailable = async (event) => {
      if (!event.data || event.data.size < 1200) return;
      try {
        const text = await transcribeChunk(event.data);
        if (text) addTranscript(text, 'Live Mix');
      } catch (err) {
        addLiveOutput('research', `Transcription issue: ${err.message}`);
      }
    };

    recorder.onstart = async () => {
      state.listening = true;
      setStatus('Listening live… alternating outputs every ~2 minutes');
      startBtn.disabled = true;
      stopBtn.disabled = false;
      startAutomationScheduler();
      await runAlternatingAutomation();
    };

    recorder.onstop = () => setStatus('Stopped');
    recorder.start(8000);
  } catch (err) {
    setStatus(`Unable to start: ${err.message}`, true);
    stopListening();
  }
}

function stopTracks(stream) {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
}

function stopListening() {
  state.listening = false;
  stopAutomationScheduler();

  if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();

  stopTracks(state.micStream);
  stopTracks(state.systemStream);
  stopTracks(state.mixedStream);

  if (state.audioContext && state.audioContext.state !== 'closed') state.audioContext.close();

  state.recorder = null;
  state.micStream = null;
  state.systemStream = null;
  state.mixedStream = null;
  state.audioContext = null;

  startBtn.disabled = false;
  stopBtn.disabled = true;
  setStatus('Stopped');
}

function clearSession() {
  stopListening();
  state.entries = [];
  transcriptEl.textContent = '';
  liveOutputEl.textContent = '';
  setStatus('Idle');
}

function runSimulation() {
  clearSession();
  const script = [
    'Welcome everyone. Today we are discussing the future of remote work and how teams maintain trust.',
    'We found productivity increased, but burnout also rose when people had too many meetings.',
    'Managers struggle with measuring outcomes instead of time online, creating cognitive overload.',
    'When onboarding new hires remotely, small rituals seem to improve motivation and social safety.',
  ];

  let i = 0;
  let mode = 'question';
  setStatus('Simulation running…');

  const interval = setInterval(async () => {
    if (i >= script.length) {
      clearInterval(interval);
      setStatus('Simulation complete');
      return;
    }

    addTranscript(script[i], i % 2 === 0 ? 'Host' : 'Guest');

    if (mode === 'question') {
      await generateStrategistQuestion('simulation');
      mode = 'research';
    } else {
      await conductResearch('simulation');
      mode = 'question';
    }

    i += 1;
  }, 2200);
}

startBtn.addEventListener('click', startListening);
stopBtn.addEventListener('click', stopListening);
clearBtn.addEventListener('click', clearSession);
simulateBtn.addEventListener('click', runSimulation);
loadSourcesBtn.addEventListener('click', loadSourceContext);
setupToggleBtn.addEventListener('click', () => setSetupDrawer(!setupDrawerEl.classList.contains('open')));
closeSetupBtn.addEventListener('click', () => setSetupDrawer(false));
setupDrawerEl.addEventListener('click', (event) => {
  if (event.target === setupDrawerEl) setSetupDrawer(false);
});
