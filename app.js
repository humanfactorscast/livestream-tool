const transcriptEl = document.getElementById('transcript');
const statusEl = document.getElementById('status');
const questionsEl = document.getElementById('questions');
const researchEl = document.getElementById('research');
const entitiesEl = document.getElementById('entities');
const template = document.getElementById('itemTemplate');

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const clearBtn = document.getElementById('clearBtn');
const simulateBtn = document.getElementById('simulateBtn');
const manualQuestionBtn = document.getElementById('manualQuestion');
const manualResearchBtn = document.getElementById('manualResearch');
const apiKeyInput = document.getElementById('apiKey');
const topicHintInput = document.getElementById('topicHint');

const state = {
  recognition: null,
  listening: false,
  entries: [],
  extractedEntities: new Set(),
  strategistInterval: null,
  pauseTimeout: null,
};

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? 'var(--danger)' : 'var(--accent-2)';
}

function addTranscript(text, speaker = 'Live') {
  const entry = { text, speaker, ts: Date.now() };
  state.entries.push(entry);
  const line = document.createElement('p');
  line.className = 'transcript-line';
  line.innerHTML = `<strong>${speaker}:</strong> ${escapeHtml(text)}`;
  transcriptEl.appendChild(line);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  runScribe(entry);
  resetPauseTimer();
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

function getRollingWindow(seconds = 60) {
  const cutoff = Date.now() - seconds * 1000;
  return state.entries.filter((e) => e.ts >= cutoff).map((e) => `${e.speaker}: ${e.text}`).join('\n');
}

function resetPauseTimer() {
  clearTimeout(state.pauseTimeout);
  state.pauseTimeout = setTimeout(() => generateStrategistQuestion('pause-detected'), 4500);
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

async function generateStrategistQuestion(reason = 'manual') {
  const windowText = getRollingWindow(60);
  if (!windowText) return;

  const systemPrompt = 'You are an expert podcast co-host. Listen to the guest\'s last statements. Identify unexplored angles, assumptions, or areas needing clarification. Output exactly one concise, provocative question only.';
  const userPrompt = `Reason: ${reason}\nTopic hint: ${topicHintInput.value.trim() || 'none'}\nTranscript window:\n${windowText}`;

  try {
    const aiQuestion = await callOpenAI(systemPrompt, userPrompt);
    const question = aiQuestion || fallbackQuestion(windowText);
    appendListItem(questionsEl, question);
  } catch (err) {
    appendListItem(questionsEl, `${fallbackQuestion(windowText)} (fallback: ${err.message})`);
  }
}

function fallbackQuestion(windowText) {
  const lastSentence = windowText.split(/[\n.?!]/).map((s) => s.trim()).filter(Boolean).at(-1) || 'that point';
  return `What assumption is hiding inside "${lastSentence.slice(0, 90)}", and what evidence would change your mind?`;
}

function extractConcepts(text) {
  const terms = [...text.matchAll(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*\b/g)].map((m) => m[0]);
  const keywords = [...text.toLowerCase().matchAll(/\b(burnout|cognitive load|ergonomics|attention|habit|stress|motivation|remote work|productivity|fatigue|trust|bias)\b/g)].map((m) => m[0]);
  return [...new Set([...terms, ...keywords])].slice(0, 5);
}

async function conductResearch() {
  const windowText = getRollingWindow(90);
  if (!windowText) return;

  const concepts = extractConcepts(windowText);
  if (!concepts.length) {
    appendListItem(researchEl, 'No clear concept yet. Wait for more dialogue context.');
    return;
  }

  for (const concept of concepts.slice(0, 2)) {
    try {
      const fact = await fetchWikiSummary(concept);
      appendListItem(researchEl, `${concept}: ${fact}`, 'fact');
    } catch {
      appendListItem(researchEl, `${concept}: no quick source found. Ask: "How does this affect behavior under pressure?"`);
    }
  }

  try {
    const ai = await callOpenAI(
      'You are a human factors research assistant. Return one short evidence-backed angle for live discussion. Mention why it matters for behavior or cognition.',
      `Concepts: ${concepts.join(', ')}\nTranscript: ${windowText}`,
    );
    if (ai) appendListItem(researchEl, ai, 'fact');
  } catch {
    // silent fallback
  }
}

async function fetchWikiSummary(term) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Not found');
  const json = await res.json();
  return (json.extract || 'No summary available.').slice(0, 220);
}

function runScribe(entry) {
  const found = extractConcepts(entry.text);
  for (const item of found) {
    const key = item.toLowerCase();
    if (state.extractedEntities.has(key)) continue;
    state.extractedEntities.add(key);
    appendListItem(entitiesEl, item);
  }
}

function startListening() {
  if (!SpeechRecognition) {
    setStatus('SpeechRecognition is unavailable in this browser. Use Chrome/Edge.', true);
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    state.listening = true;
    setStatus('Listening live…');
    startBtn.disabled = true;
    stopBtn.disabled = false;
    state.strategistInterval = setInterval(() => generateStrategistQuestion('interval'), 45000);
  };

  recognition.onresult = (event) => {
    let finalText = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) finalText += `${result[0].transcript.trim()} `;
    }
    if (finalText.trim()) addTranscript(finalText.trim(), 'Guest');
  };

  recognition.onerror = (event) => {
    setStatus(`Speech recognition error: ${event.error}`, true);
  };

  recognition.onend = () => {
    if (state.listening) recognition.start();
  };

  state.recognition = recognition;
  recognition.start();
}

function stopListening() {
  state.listening = false;
  clearInterval(state.strategistInterval);
  clearTimeout(state.pauseTimeout);
  if (state.recognition) state.recognition.stop();
  startBtn.disabled = false;
  stopBtn.disabled = true;
  setStatus('Stopped');
}

function clearSession() {
  stopListening();
  state.entries = [];
  state.extractedEntities.clear();
  transcriptEl.textContent = '';
  questionsEl.textContent = '';
  researchEl.textContent = '';
  entitiesEl.textContent = '';
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
  setStatus('Simulation running…');
  const interval = setInterval(async () => {
    if (i >= script.length) {
      clearInterval(interval);
      setStatus('Simulation complete');
      return;
    }
    addTranscript(script[i], i % 2 === 0 ? 'Host' : 'Guest');
    await generateStrategistQuestion('simulation');
    await conductResearch();
    i += 1;
  }, 2200);
}

startBtn.addEventListener('click', startListening);
stopBtn.addEventListener('click', stopListening);
clearBtn.addEventListener('click', clearSession);
simulateBtn.addEventListener('click', runSimulation);
manualQuestionBtn.addEventListener('click', () => generateStrategistQuestion('manual'));
manualResearchBtn.addEventListener('click', conductResearch);
