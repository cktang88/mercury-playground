// Per-1M-token prices from https://docs.inceptionlabs.ai/get-started/models
// (mercury-3 is at 50%-off launch pricing; regular is $0.20 / $0.02 / $0.70).
const MODELS = {
  'mercury-3': { label: 'Mercury 3', input: 0.10, cached: 0.01, output: 0.35, defaultEffort: 'low' },
  'mercury-2.5': { label: 'Mercury 2.5', input: 0.20, cached: 0.02, output: 0.75, defaultEffort: 'medium' }
};

const panesEl = document.getElementById('panes');
const input = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const newChatBtn = document.getElementById('new-chat-btn');
const tempSlider = document.getElementById('temperature');
const tempValue = document.getElementById('temp-value');
const systemPrompt = document.getElementById('system-prompt');
const systemHint = document.getElementById('system-hint');
const effortSelect = document.getElementById('reasoning-effort');
const maxTokensInput = document.getElementById('max-tokens');
const diffusingInput = document.getElementById('diffusing');
const usageTable = document.getElementById('usage-table');
const statusDot = document.querySelector('.status-dot');
const statusText = document.querySelector('.status-text');
const connectionStatus = document.getElementById('connection-status');
const viewButtons = document.querySelectorAll('.view-toggle button');

// Each model keeps its own history so its prompt prefix only ever grows by appending,
// which is what lets Inception's automatic prefix cache hit on every follow-up turn.
const panes = Object.keys(MODELS).map(model => createPane(model));
let view = 'compare';
let isStreaming = false;

function createPane(model) {
  const el = document.createElement('section');
  el.className = 'pane';
  el.innerHTML = `
    <header class="pane-header">
      <span class="pane-title">${MODELS[model].label}</span>
      <code class="pane-model">${model}</code>
    </header>
    <div class="chat-output"></div>
    <footer class="pane-stats">No requests yet</footer>`;
  panesEl.appendChild(el);
  return {
    model,
    el,
    output: el.querySelector('.chat-output'),
    stats: el.querySelector('.pane-stats'),
    history: [],
    totals: { requests: 0, prompt: 0, cached: 0, completion: 0, reasoning: 0, cost: 0 }
  };
}

function visiblePanes() {
  return view === 'compare' ? panes : panes.filter(p => p.model === view);
}

function setView(next) {
  view = next;
  viewButtons.forEach(b => b.setAttribute('aria-selected', b.dataset.view === view));
  panesEl.classList.toggle('compare', view === 'compare');
  panes.forEach(p => { p.el.hidden = !visiblePanes().includes(p); });
}

viewButtons.forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
setView(view);

input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  sendBtn.disabled = input.value.trim() === '' || isStreaming;
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);
newChatBtn.addEventListener('click', newChat);

tempSlider.addEventListener('input', () => {
  tempValue.textContent = tempSlider.value;
});

async function checkStatus() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error('Not ok');
    const data = await res.json();
    statusDot.classList.remove('error');
    statusDot.classList.add('connected');
    if (!data.apiKeyConfigured) {
      statusText.textContent = 'No API key';
    } else if (data.modelsAvailable) {
      const missing = Object.keys(MODELS).filter(m => !data.models.includes(m));
      statusText.textContent = missing.length ? `API ready (missing: ${missing.join(', ')})` : 'API ready';
    } else {
      statusText.textContent = 'Checking API...';
    }
    connectionStatus.textContent = 'Connected';
  } catch {
    statusDot.classList.remove('connected');
    statusDot.classList.add('error');
    statusText.textContent = 'Not responding';
    connectionStatus.textContent = 'Not responding';
  }
}

checkStatus();
setInterval(checkStatus, 30000);

function newChat() {
  if (isStreaming) return;
  for (const pane of panes) {
    pane.history = [];
    pane.output.innerHTML = '';
    pane.stats.textContent = 'No requests yet';
  }
  updateSystemLock();
}

// Editing the system prompt mid-conversation would change the start of the prefix
// and invalidate the whole cache, so it is frozen until a new chat.
function updateSystemLock() {
  const started = panes.some(p => p.history.length > 0);
  systemPrompt.readOnly = started;
  systemHint.textContent = started ? 'Locked for this chat to keep the cached prefix stable. Start a new chat to change it.' : '';
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text || isStreaming) return;

  isStreaming = true;
  sendBtn.disabled = true;
  input.value = '';
  input.style.height = 'auto';

  const settings = {
    temperature: parseFloat(tempSlider.value),
    reasoning_effort: effortSelect.value || undefined,
    max_completion_tokens: parseInt(maxTokensInput.value) || undefined,
    diffusing: diffusingInput.checked
  };

  const targets = visiblePanes();
  for (const pane of targets) {
    if (pane.history.length === 0 && systemPrompt.value.trim()) {
      pane.history.push({ role: 'system', content: systemPrompt.value.trim() });
    }
    pane.history.push({ role: 'user', content: text });
    addMessage(pane, 'user', text);
  }
  updateSystemLock();

  await Promise.all(targets.map(pane => streamReply(pane, settings)));

  isStreaming = false;
  sendBtn.disabled = input.value.trim() === '';
  renderUsage();
}

async function streamReply(pane, settings) {
  const { contentSpan, timeSpan } = addMessage(pane, 'assistant', '');
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  contentSpan.after(cursor);
  pane.stats.textContent = 'Generating...';

  const start = performance.now();
  let firstToken = null;
  let text = '';
  let usage = null;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: pane.model, messages: pane.history, ...settings })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        let json;
        try { json = JSON.parse(data); } catch { continue; }
        if (json.usage) usage = json.usage;
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          firstToken ??= performance.now();
          // In diffusing mode each chunk is the full text so far, not an increment.
          text = settings.diffusing ? delta : text + delta;
          contentSpan.textContent = text;
          pane.output.scrollTop = pane.output.scrollHeight;
        }
      }
    }

    // Store the reply verbatim: next turn's prefix must match byte-for-byte to hit the cache.
    pane.history.push({ role: 'assistant', content: text });
    recordStats(pane, usage, start, firstToken, performance.now());
  } catch (err) {
    contentSpan.textContent = text + ` [Error: ${err.message}]`;
    // Drop the unanswered user turn so the history stays a valid, cacheable prefix.
    if (pane.history.at(-1)?.role === 'user') pane.history.pop();
    pane.stats.textContent = 'Request failed';
  } finally {
    cursor.remove();
    timeSpan.textContent = new Date().toLocaleTimeString();
  }
}

function recordStats(pane, usage, start, firstToken, end) {
  const totalMs = end - start;
  const ttftMs = (firstToken ?? end) - start;
  if (!usage) {
    pane.stats.textContent = `TTFT ${fmtMs(ttftMs)} • total ${fmtMs(totalMs)} • no usage returned`;
    return;
  }

  const prompt = usage.prompt_tokens || 0;
  const cached = usage.prompt_tokens_details?.cached_tokens ?? usage.cached_input_tokens ?? 0;
  const completion = usage.completion_tokens || 0;
  const reasoning = usage.completion_tokens_details?.reasoning_tokens ?? usage.reasoning_tokens ?? 0;
  const price = MODELS[pane.model];
  const cost = ((prompt - cached) * price.input + cached * price.cached + completion * price.output) / 1e6;
  const tps = completion / (totalMs / 1000);

  Object.assign(pane.totals, {
    requests: pane.totals.requests + 1,
    prompt: pane.totals.prompt + prompt,
    cached: pane.totals.cached + cached,
    completion: pane.totals.completion + completion,
    reasoning: pane.totals.reasoning + reasoning,
    cost: pane.totals.cost + cost
  });

  pane.stats.innerHTML = [
    `TTFT <b>${fmtMs(ttftMs)}</b>`,
    `total <b>${fmtMs(totalMs)}</b>`,
    `<b>${Math.round(tps)}</b> tok/s`,
    `in <b>${prompt}</b> (<b>${cached}</b> cached)`,
    `out <b>${completion}</b>${reasoning ? ` (${reasoning} reasoning)` : ''}`,
    `<b>$${cost.toFixed(6)}</b>`
  ].join(' • ');
}

function renderUsage() {
  const rows = [
    ['Requests', t => t.requests],
    ['Prompt tokens', t => t.prompt],
    ['Cached tokens', t => t.cached],
    ['Cache hit rate', t => t.prompt ? `${Math.round(100 * t.cached / t.prompt)}%` : '-'],
    ['Output tokens', t => t.completion],
    ['Reasoning tokens', t => t.reasoning],
    ['Est. cost', t => `$${t.cost.toFixed(5)}`]
  ];
  usageTable.innerHTML = `
    <table>
      <thead><tr><th></th>${panes.map(p => `<th>${MODELS[p.model].label}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(([name, fn]) =>
        `<tr><td>${name}</td>${panes.map(p => `<td>${fn(p.totals)}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>`;
}

renderUsage();

function addMessage(pane, role, text) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.innerHTML = `<span class="message-content"></span><span class="message-time"></span>`;
  const contentSpan = div.querySelector('.message-content');
  const timeSpan = div.querySelector('.message-time');
  contentSpan.textContent = text;
  if (role === 'user') timeSpan.textContent = new Date().toLocaleTimeString();
  pane.output.appendChild(div);
  pane.output.scrollTop = pane.output.scrollHeight;
  return { contentSpan, timeSpan };
}

function fmtMs(ms) {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}
