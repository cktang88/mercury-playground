require('dotenv').config();
const express = require('express');
const cors = require('cors');
const config = require('./config');

const app = express();
const PORT = process.env.PORT || 3000;

// Models, effort values and defaults live in config.js.
const CHAT_MODELS = Object.keys(config.models);
const DEFAULT_MODEL = config.paneModels[0];

// Inception is used when its key is set; otherwise OpenRouter, which serves the same
// models from Inception under an `inception/` prefix (https://openrouter.ai/inception).
const PROVIDERS = {
  inception: {
    name: 'Inception',
    url: process.env.INCEPTION_API_URL || 'https://api.inceptionlabs.ai/v1/chat/completions',
    key: process.env.INCEPTION_API_KEY,
    modelId: model => model,
    ...config.providers.inception
  },
  openrouter: {
    name: 'OpenRouter',
    url: process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions',
    key: process.env.OPENROUTER_API_KEY,
    modelId: model => `inception/${model}`,
    ...config.providers.openrouter,
    // Optional attribution headers (https://openrouter.ai/docs/api_reference/authentication)
    headers: { 'X-OpenRouter-Title': 'Mercury Playground' }
  }
};

const provider = PROVIDERS.inception.key ? PROVIDERS.inception
  : PROVIDERS.openrouter.key ? PROVIDERS.openrouter
  : null;

console.log('Provider:', provider ? `${provider.name} (${provider.url})` : 'none - set INCEPTION_API_KEY or OPENROUTER_API_KEY');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

function upstreamHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${provider.key}`,
    ...provider.headers
  };
}

// Builds the upstream request body. Only whitelisted fields are forwarded so the
// prompt prefix (messages) reaches the API exactly as the client sent it --
// prefix caching is automatic, and any change to earlier messages is a cache miss.
function buildRequest(body, stream) {
  const {
    model = DEFAULT_MODEL,
    messages,
    temperature,
    max_completion_tokens,
    reasoning_effort,
    diffusing,
    session_id,
    web_search
  } = body;

  if (!CHAT_MODELS.includes(model)) {
    throw new Error(`Unknown model "${model}". Expected one of: ${CHAT_MODELS.join(', ')}`);
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages must be a non-empty array');
  }

  const payload = { model: provider.modelId(model), messages, stream };
  // Mercury accepts temperature 0.5-1.0; anything else is reset server-side with a warning.
  const { min, max } = config.temperature;
  if (typeof temperature === 'number') payload.temperature = Math.min(max, Math.max(min, temperature));
  if (Number.isInteger(max_completion_tokens) && max_completion_tokens > 0) {
    payload.max_completion_tokens = max_completion_tokens;
  }
  // Omit to use the model default.
  const effort = provider.efforts.includes(reasoning_effort) ? reasoning_effort : undefined;

  if (provider === PROVIDERS.inception) {
    if (effort) payload.reasoning_effort = effort;
    if (stream) {
      // Final chunk carries usage, incl. prompt_tokens_details.cached_tokens.
      payload.stream_options = { include_usage: true };
      if (diffusing && provider.diffusing) payload.diffusing = true;
    }
  } else {
    // OpenRouter always returns usage (incl. cached_tokens and cost) in the last chunk.
    if (effort) payload.reasoning = { effort };
    // Sticky-routes a conversation to the same provider endpoint to keep its cache warm.
    if (typeof session_id === 'string' && session_id.length > 0 && session_id.length <= 256) {
      payload.session_id = session_id;
    }
    const tool = webSearchTool(web_search);
    if (tool) payload.tools = [tool];
  }
  return payload;
}

// Builds the `openrouter:web_search` server tool. The model decides when to search;
// OpenRouter runs the search and feeds results back to it within the same request.
// https://openrouter.ai/docs/guides/features/server-tools/web-search
function webSearchTool(options) {
  const defaults = provider.webSearch;
  const { enabled = defaults.enabled, engine = defaults.engine, mode, max_results = defaults.maxResults } = options || {};
  if (!enabled) return null;
  if (!defaults.engines.includes(engine)) throw new Error(`Unknown web search engine "${engine}"`);

  const parameters = { engine };
  const modes = defaults.modes[engine];
  if (modes && mode) {
    if (!modes.includes(mode)) throw new Error(`Unknown ${engine} search mode "${mode}". Expected one of: ${modes.join(', ')}`);
    parameters.mode = mode;
  } else if (modes?.includes(defaults.mode)) {
    parameters.mode = defaults.mode;
  }
  if (Number.isInteger(max_results)) parameters.max_results = Math.min(25, Math.max(1, max_results));
  return { type: 'openrouter:web_search', parameters };
}

app.post('/api/chat', async (req, res) => {
  if (!provider) {
    return res.status(500).json({ error: 'Set INCEPTION_API_KEY or OPENROUTER_API_KEY in .env' });
  }

  let payload;
  try {
    payload = buildRequest(req.body, true);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  console.log('Request:', {
    provider: provider.name,
    model: payload.model,
    messages: payload.messages.length,
    reasoning_effort: payload.reasoning_effort || payload.reasoning?.effort || '(default)',
    diffusing: !!payload.diffusing,
    web_search: payload.tools ? JSON.stringify(payload.tools[0].parameters) : 'off'
  });

  // Stop generating (and billing) if the browser goes away mid-stream.
  const controller = new AbortController();
  res.on('close', () => controller.abort());

  try {
    const response = await fetch(provider.url, {
      method: 'POST',
      headers: upstreamHeaders(),
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    console.log(`API Response status (${payload.model}):`, response.status);

    if (!response.ok) {
      const errorBody = await response.text();
      return res.status(response.status).json({
        error: `API Error: ${errorBody}`,
        status: response.status
      });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Forward raw bytes; decoding here could split multi-byte characters across chunks.
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }

    res.end();
  } catch (error) {
    if (controller.signal.aborted) return;
    console.error('Server error:', error.message);
    if (res.headersSent) return res.end();
    res.status(500).json({
      error: `Server error: ${error.message}`,
      url: provider.url
    });
  }
});

// Lists the playground's model ids the provider serves; for OpenRouter, also verifies the key.
async function listModels() {
  const base = provider.url.replace('/chat/completions', '');
  if (provider === PROVIDERS.openrouter) {
    // GET /models is public, so check the key separately (https://openrouter.ai/api/v1/key).
    const keyRes = await fetch(`${base}/key`, { headers: upstreamHeaders() });
    if (!keyRes.ok) return { ok: false, models: [] };
  }
  const modelsRes = await fetch(`${base}/models`, { headers: upstreamHeaders() });
  if (!modelsRes.ok) return { ok: false, models: [] };
  const ids = ((await modelsRes.json()).data || []).map(m => m.id);
  return { ok: true, models: CHAT_MODELS.filter(m => ids.includes(provider.modelId(m))) };
}

// Settings the UI needs: models, temperature range, and what the active provider supports.
app.get('/api/config', (req, res) => {
  res.json({
    provider: provider?.name || null,
    models: config.paneModels.map(id => ({ id, ...config.models[id] })),
    temperature: config.temperature,
    efforts: provider?.efforts || [],
    defaultEffort: provider?.defaultEffort || '',
    diffusing: !!provider?.diffusing,
    webSearch: provider?.webSearch || null
  });
});

app.get('/api/health', async (req, res) => {
  if (!provider) {
    return res.json({ status: 'ok', apiKeyConfigured: false, modelsAvailable: false, models: [] });
  }
  const info = { provider: provider.name, endpoint: provider.url, apiKeyConfigured: true };
  try {
    const { ok, models } = await listModels();
    res.json({ status: 'ok', ...info, modelsAvailable: ok, models });
  } catch (error) {
    res.json({ status: 'error', ...info, error: error.message });
  }
});

app.get('/api/test', async (req, res) => {
  if (!provider) {
    return res.json({ status: 'error', error: 'Set INCEPTION_API_KEY or OPENROUTER_API_KEY in .env' });
  }
  try {
    const payload = buildRequest({
      model: req.query.model || DEFAULT_MODEL,
      messages: [{ role: 'user', content: 'hello' }]
    }, false);
    const response = await fetch(provider.url, {
      method: 'POST',
      headers: upstreamHeaders(),
      body: JSON.stringify(payload)
    });

    const body = await response.json();
    res.json({
      provider: provider.name,
      status: response.status,
      body,
      message: response.status === 200 ? 'API works!' : 'API error - check the response'
    });
  } catch (error) {
    res.json({ status: 'error', error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Mercury Playground running at http://localhost:${PORT}`);
});
