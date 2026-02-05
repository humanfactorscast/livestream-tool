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
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const state = {
  listening: false,
  entries: [],
  micStream: null,
  systemStream: null,
  mixedStream: null,
  recorder: null,
  audioContext: null,
  recognition: null,
  systemMonitorGain: null,
  automationTimer: null,
  nextAutoAction: 'question',
  sourceDocs: [],
};

function setSetupDrawer(open) {
  setupDrawerEl.classList.toggle('open', open);
  setupDrawerEl.setAttribute('aria-hidden', open ? 'false' : 'true');
  setupToggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

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
  if (!text.trim()) return;
  state.entries.push({ text, speaker, ts: Date.now() });
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
  const clean = stripMarkdown(await res.text()).slice(0, 12000);
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
      loaded.push({ url, text, keywords: extractKeywords(text) });
    } catch {
      // skip failed source
    }
  }

  state.sourceDocs = loaded;
  if (!loaded.length) return setSourcesStatus('Could not load any URLs (check URL format or site access).', true);
  setSourcesStatus(`Loaded ${loaded.length}/${urls.length} URLs for context`);
}

function getSourceContextSnippet(windowText) {
  if (!state.sourceDocs.length) return '';
  const windowKeywords = extractKeywords(windowText);
  return state.sourceDocs
    .map((doc) => ({ doc, overlap: doc.keywords.filter((k) => windowKeywords.includes(k)).length }))
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 2)
    .map(({ doc, overlap }) => `Source (${overlap} overlap): ${doc.url}\n${doc.text.slice(0, 280)}`)
    .join('\n\n');
}

async function callOpenAI(systemPrompt, userPrompt) {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) return null;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI request failed (${res.status})`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

function localQuestionFallback(windowText, sourceContext) {
  const lines = windowText.split('\n').map((s) => s.trim()).filter(Boolean);
  const lastLine = lines.at(-1) || 'the latest claim';
  const topic = extractKeywords(windowText)[0] || 'this claim';

  const templates = [
    `What would make this position on ${topic} collapse in front of the audience, and are you willing to name that threshold now?`,
    `Who is harmed if your ${topic} take is wrong, and what trade-off are you currently underweighting?`,
    `If we force a binary choice on ${topic} right now, which side do you pick and what uncomfortable cost comes with it?`,
  ];

  const chosen = templates[Math.floor(Math.random() * templates.length)];
  const sourceTag = sourceContext
    ? ' Challenge or validate your answer against one loaded source in the next response.'
    : '';

  return `${chosen} (Anchor: "${lastLine.slice(0, 80)}")${sourceTag}`;
}

function localResearchFallback(windowText, sourceContext) {
  const keywords = extractKeywords(windowText);
  if (sourceContext) {
    return `Source-backed angle: ${sourceContext.slice(0, 230)}...`;
  }
  return `Context angle: clarify the claim around ${keywords[0] || 'the current topic'}, request a concrete example, and ask what trade-off is being ignored.`;
}

async function generateStrategistQuestion(reason = 'automation') {
  const windowText = getRollingWindow(60);
  if (!windowText) return;
  const sourceContext = getSourceContextSnippet(windowText);

  try {
    const ai = await callOpenAI(
      'You are a sharp podcast producer. Generate exactly ONE host question that is engaging, high-stakes, specific, and useful. Prefer tension, trade-offs, contradictions, accountability, or testable claims. Avoid generic prompts, politeness fluff, and broad openers like "tell me more". The question must be natural to ask live and should create discussion heat without being abusive. If source context exists, use it to challenge or validate a claim.',
      `Reason: ${reason}\nTopic hint: ${topicHintInput.value.trim() || 'none'}\nTranscript:\n${windowText}\n\nSource context:\n${sourceContext || 'none'}\n\nReturn only the question text.`,
    );
    addLiveOutput('question', ai || localQuestionFallback(windowText, sourceContext));
  } catch {
    addLiveOutput('question', localQuestionFallback(windowText, sourceContext));
  }
}

async function conductResearch(reason = 'automation') {
  const windowText = getRollingWindow(90);
  if (!windowText) return;
  const sourceContext = getSourceContextSnippet(windowText);

  try {
    const ai = await callOpenAI(
      'You are a human factors assistant. Return one short context note with practical relevance. Use source context when available.',
      `Reason: ${reason}\nTranscript:\n${windowText}\n\nSource context:\n${sourceContext || 'none'}`,
    );
    addLiveOutput('research', ai || localResearchFallback(windowText, sourceContext));
  } catch {
    addLiveOutput('research', localResearchFallback(windowText, sourceContext));
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

async function transcribeChunkOpenAI(audioBlob) {
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
  if (!res.ok) throw new Error(`Transcription failed (${res.status})`);
  const data = await res.json();
  return data.text?.trim() || null;
}

function stopTracks(stream) {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
}

function startBrowserSpeechRecognition() {
  if (!SpeechRecognition) {
    setStatus('No OpenAI key and browser speech recognition unavailable. Use Chrome/Edge or add an API key.', true);
    return false;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    let finalText = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      if (event.results[i].isFinal) finalText += `${event.results[i][0].transcript.trim()} `;
    }
    if (finalText.trim()) addTranscript(finalText.trim(), 'Mic (Local)');
  };

  recognition.onerror = () => setStatus('Local speech recognition encountered an issue. Retrying…', true);
  recognition.onend = () => {
    if (state.listening && state.recognition) {
      try { state.recognition.start(); } catch { /* no-op */ }
    }
  };

  state.recognition = recognition;
  recognition.start();
  setStatus('Listening (local lightweight mode, no API key)…');
  return true;
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
      throw new Error('System audio was not shared. Re-try and enable tab/window audio in share dialog.');
    }
    systemStream.getVideoTracks().forEach((track) => {
      track.onended = () => stopListening();
    });
  }

  return { micStream, systemStream };
}

function mixAudioStreams({ micStream, systemStream }) {
  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();

  if (micStream) {
    const micSource = audioContext.createMediaStreamSource(micStream);
    micSource.connect(destination);
  }

  let systemMonitorGain = null;
  if (systemStream) {
    const systemSource = audioContext.createMediaStreamSource(systemStream);
    systemSource.connect(destination);

    // Keep shared system audio audible locally while also capturing it.
    systemMonitorGain = audioContext.createGain();
    systemMonitorGain.gain.value = 1.0;
    systemSource.connect(systemMonitorGain);
    systemMonitorGain.connect(audioContext.destination);
  }

  return { mixedStream: destination.stream, audioContext, systemMonitorGain };
}

async function startListening() {
  if (sourceUrlsInput.value.trim() && !state.sourceDocs.length) await loadSourceContext();

  state.listening = true;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  startAutomationScheduler();
  await runAlternatingAutomation();

  const hasApiKey = Boolean(apiKeyInput.value.trim());

  if (!hasApiKey) {
    const ok = startBrowserSpeechRecognition();
    if (!ok) {
      stopListening();
      return;
    }
    if (useSystemAudioInput.checked) {
      addLiveOutput('research', 'Note: no-key local mode transcribes microphone only (lightweight). Add API key for mixed system+mic transcription.');
    }
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) {
    setStatus('Media capture APIs unavailable. Falling back to local mic transcription mode.');
    startBrowserSpeechRecognition();
    return;
  }

  try {
    setStatus('Requesting microphone/system audio permissions…');
    const { micStream, systemStream } = await requestInputStreams();
    const { mixedStream, audioContext, systemMonitorGain } = mixAudioStreams({ micStream, systemStream });
    state.micStream = micStream;
    state.systemStream = systemStream;
    state.mixedStream = mixedStream;
    state.audioContext = audioContext;
    state.systemMonitorGain = systemMonitorGain;

    const recorder = new MediaRecorder(mixedStream, { mimeType: 'audio/webm;codecs=opus' });
    state.recorder = recorder;

    recorder.ondataavailable = async (event) => {
      if (!event.data || event.data.size < 1200) return;
      try {
        const text = await transcribeChunkOpenAI(event.data);
        if (text) addTranscript(text, 'Live Mix');
      } catch {
        addLiveOutput('research', 'Transcription issue detected; continuing with current context.');
      }
    };

    recorder.onstart = () => setStatus('Listening live with mixed audio (OpenAI transcription)…');
    recorder.start(8000);
  } catch (err) {
    setStatus(`Mixed-audio capture failed: ${err.message}. Falling back to local mode.`, true);
    startBrowserSpeechRecognition();
  }
}

function stopListening() {
  state.listening = false;
  stopAutomationScheduler();

  if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();
  if (state.recognition) {
    try { state.recognition.stop(); } catch { /* no-op */ }
  }

  stopTracks(state.micStream);
  stopTracks(state.systemStream);
  stopTracks(state.mixedStream);
  if (state.systemMonitorGain) {
    try { state.systemMonitorGain.disconnect(); } catch { /* no-op */ }
  }
  if (state.audioContext && state.audioContext.state !== 'closed') state.audioContext.close();

  state.recorder = null;
  state.recognition = null;
  state.micStream = null;
  state.systemStream = null;
  state.mixedStream = null;
  state.audioContext = null;
  state.systemMonitorGain = null;

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
