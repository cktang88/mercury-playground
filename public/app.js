// Models, prices, effort values and web search defaults come from GET /api/config
// (see config.js on the server).
let config;
let MODELS = {};

const panesEl = document.getElementById('panes');
const viewToggle = document.getElementById('view-toggle');
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
const diffusingRow = document.getElementById('diffusing-row');
const searchCard = document.getElementById('search-card');
const searchEnabled = document.getElementById('search-enabled');
const searchEngine = document.getElementById('search-engine');
const searchMode = document.getElementById('search-mode');
const searchModeRow = document.getElementById('search-mode-row');
const searchMaxResults = document.getElementById('search-max-results');
const searchHint = document.getElementById('search-hint');
const usageTable = document.getElementById('usage-table');
const statusDot = document.querySelector('.status-dot');
const statusText = document.querySelector('.status-text');
const connectionStatus = document.getElementById('connection-status');

// Each model keeps its own history so its prompt prefix only ever grows by appending,
// which is what lets the automatic prefix cache hit on every follow-up turn.
let panes = [];
let view = 'compare';
let isStreaming = false;

function createPane(model) {
  const el = document.createElement('section');
  el.className = 'pane';
  el.innerHTML = `
    <header class="pane-header">
      <span class="pane-title"></span>
      <code class="pane-model"></code>
    </header>
    <div class="chat-output"></div>
    <footer class="pane-stats">No requests yet</footer>`;
  el.querySelector('.pane-title').textContent = MODELS[model].label;
  el.querySelector('.pane-model').textContent = model;
  panesEl.appendChild(el);
  return {
    model,
    el,
    output: el.querySelector('.chat-output'),
    stats: el.querySelector('.pane-stats'),
    history: [],
    sessionId: crypto.randomUUID(),
    totals: { requests: 0, prompt: 0, cached: 0, completion: 0, reasoning: 0, searches: 0, cost: 0 }
  };
}

function visiblePanes() {
  return view === 'compare' ? panes : panes.filter(p => p.model === view);
}

function setView(next) {
  view = next;
  viewToggle.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', b.dataset.view === view));
  panesEl.classList.toggle('compare', view === 'compare' && panes.length > 1);
  panes.forEach(p => { p.el.hidden = !visiblePanes().includes(p); });
}

function addViewButton(viewId, label) {
  const b = document.createElement('button');
  b.dataset.view = viewId;
  b.setAttribute('role', 'tab');
  b.textContent = label;
  b.addEventListener('click', () => setView(viewId));
  viewToggle.appendChild(b);
}

function capitalize(s) {
  return s[0].toUpperCase() + s.slice(1);
}

function fillSelect(select, values, selected, extra = '') {
  select.innerHTML = extra;
  for (const v of values) select.add(new Option(capitalize(v), v));
  select.value = values.includes(selected) ? selected : (select.options[0]?.value ?? '');
}

async function init() {
  config = await (await fetch('/api/config')).json();
  MODELS = Object.fromEntries(config.models.map(m => [m.id, m]));

  panes = config.models.map(m => createPane(m.id));
  config.models.forEach(m => addViewButton(m.id, m.label));
  if (panes.length > 1) addViewButton('compare', 'Side by side');
  setView(panes.length > 1 ? 'compare' : panes[0].model);

  const t = config.temperature;
  Object.assign(tempSlider, { min: t.min, max: t.max, step: t.step, value: t.default });
  tempValue.textContent = t.default;

  fillSelect(effortSelect, config.efforts, config.defaultEffort, '<option value="">Model default</option>');

  diffusingInput.disabled = !config.diffusing;
  diffusingRow.title = config.diffusing ? '' : `Not supported via ${config.provider}`;

  const ws = config.webSearch;
  searchCard.hidden = !ws;
  if (ws) {
    searchEnabled.checked = ws.enabled;
    fillSelect(searchEngine, ws.engines, ws.engine);
    updateSearchModes(ws.mode);
    searchMaxResults.value = ws.maxResults;
  }

  renderUsage();
  checkStatus();
  setInterval(checkStatus, 30000);
}

function updateSearchModes(preferred) {
  const modes = config.webSearch.modes[searchEngine.value] || [];
  searchModeRow.hidden = modes.length === 0;
  fillSelect(searchMode, modes, preferred ?? searchMode.value);
}

searchEngine.addEventListener('change', () => updateSearchModes(config.webSearch.mode));

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
    connectionStatus.textContent = data.provider ? `via ${data.provider}` : 'Connected';
  } catch {
    statusDot.classList.remove('connected');
    statusDot.classList.add('error');
    statusText.textContent = 'Not responding';
    connectionStatus.textContent = 'Not responding';
  }
}

function newChat() {
  if (isStreaming) return;
  for (const pane of panes) {
    pane.history = [];
    pane.sessionId = crypto.randomUUID();
    pane.output.innerHTML = '';
    pane.stats.textContent = 'No requests yet';
  }
  updateLocks();
}

// The system prompt and the tool list sit at the start of the prompt, so changing
// either mid-conversation would invalidate the cache. Both are frozen until a new chat.
function updateLocks() {
  const started = panes.some(p => p.history.length > 0);
  systemPrompt.readOnly = started;
  systemHint.textContent = started ? 'Locked for this chat to keep the cached prefix stable. Start a new chat to change it.' : '';
  for (const el of [searchEnabled, searchEngine, searchMode, searchMaxResults]) el.disabled = started;
  searchHint.textContent = started ? 'Locked for this chat (part of the cached prefix). Start a new chat to change it.' : '';
}

function webSearchSettings() {
  if (!config.webSearch) return undefined;
  return {
    enabled: searchEnabled.checked,
    engine: searchEngine.value,
    mode: searchModeRow.hidden ? undefined : searchMode.value,
    max_results: parseInt(searchMaxResults.value) || undefined
  };
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text || isStreaming || !config) return;

  isStreaming = true;
  sendBtn.disabled = true;
  input.value = '';
  input.style.height = 'auto';

  const settings = {
    temperature: parseFloat(tempSlider.value),
    reasoning_effort: effortSelect.value || undefined,
    max_completion_tokens: parseInt(maxTokensInput.value) || undefined,
    diffusing: diffusingInput.checked,
    web_search: webSearchSettings()
  };

  const targets = visiblePanes();
  for (const pane of targets) {
    if (pane.history.length === 0 && systemPrompt.value.trim()) {
      pane.history.push({ role: 'system', content: systemPrompt.value.trim() });
    }
    pane.history.push({ role: 'user', content: text });
    addMessage(pane, 'user', text);
  }
  updateLocks();

  await Promise.all(targets.map(pane => streamReply(pane, settings)));

  isStreaming = false;
  sendBtn.disabled = input.value.trim() === '';
  renderUsage();
}

async function streamReply(pane, settings) {
  const { div, contentSpan, timeSpan } = addMessage(pane, 'assistant', '');
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  contentSpan.after(cursor);
  pane.stats.textContent = 'Generating...';

  const start = performance.now();
  let firstToken = null;
  let text = '';
  let usage = null;
  const citations = new Map();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: pane.model, messages: pane.history, session_id: pane.sessionId, ...settings })
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
        // OpenRouter reports errors after the stream has started as an `error` chunk.
        if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
        if (json.usage) usage = json.usage;
        const choice = json.choices?.[0];
        // Web search citations, in OpenAI's url_citation annotation format.
        for (const a of choice?.delta?.annotations || choice?.message?.annotations || []) {
          if (a.type === 'url_citation' && a.url_citation?.url) citations.set(a.url_citation.url, a.url_citation.title);
        }
        const delta = choice?.delta?.content;
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
    renderCitations(div, citations);
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

function renderCitations(messageDiv, citations) {
  const links = [...citations].filter(([url]) => /^https?:\/\//.test(url));
  if (links.length === 0) return;
  const list = document.createElement('ol');
  list.className = 'citations';
  for (const [url, title] of links) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = title || new URL(url).hostname;
    const li = document.createElement('li');
    li.appendChild(a);
    list.appendChild(li);
  }
  messageDiv.querySelector('.message-time').before(list);
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
  const searches = usage.server_tool_use_details?.web_search_requests ?? usage.server_tool_use?.web_search_requests ?? 0;
  const price = MODELS[pane.model].price;
  // OpenRouter reports the actual charge (incl. searches); otherwise estimate from list prices.
  const cost = typeof usage.cost === 'number' ? usage.cost
    : ((prompt - cached) * price.input + cached * price.cached + completion * price.output) / 1e6;
  const tps = completion / (totalMs / 1000);

  Object.assign(pane.totals, {
    requests: pane.totals.requests + 1,
    prompt: pane.totals.prompt + prompt,
    cached: pane.totals.cached + cached,
    completion: pane.totals.completion + completion,
    reasoning: pane.totals.reasoning + reasoning,
    searches: pane.totals.searches + searches,
    cost: pane.totals.cost + cost
  });

  pane.stats.innerHTML = [
    `TTFT <b>${fmtMs(ttftMs)}</b>`,
    `total <b>${fmtMs(totalMs)}</b>`,
    `<b>${Math.round(tps)}</b> tok/s`,
    `in <b>${prompt}</b> (<b>${cached}</b> cached)`,
    `out <b>${completion}</b>${reasoning ? ` (${reasoning} reasoning)` : ''}`,
    ...(searches ? [`<b>${searches}</b> search${searches === 1 ? '' : 'es'}`] : []),
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
    ...(config.webSearch ? [['Web searches', t => t.searches]] : []),
    ['Cost', t => `$${t.cost.toFixed(5)}`]
  ];
  usageTable.innerHTML = `
    <table>
      <thead><tr><th></th>${panes.map(p => `<th>${escapeHtml(MODELS[p.model].label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(([name, fn]) =>
        `<tr><td>${name}</td>${panes.map(p => `<td>${fn(p.totals)}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>`;
}

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
  return { div, contentSpan, timeSpan };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function fmtMs(ms) {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

init();
