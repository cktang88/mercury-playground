require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const INCEPTION_API_URL = process.env.INCEPTION_API_URL || 'https://api.inceptionlabs.ai/v1/chat/completions';
const API_KEY = process.env.INCEPTION_API_KEY;

// Chat models served by /v1/chat/completions (https://docs.inceptionlabs.ai/get-started/models)
const CHAT_MODELS = ['mercury-3', 'mercury-2.5', 'mercury-2'];
const DEFAULT_MODEL = 'mercury-3';
const REASONING_EFFORTS = ['instant', 'low', 'medium', 'high'];

console.log('INCEPTION_API_URL:', INCEPTION_API_URL);
console.log('API_KEY configured:', !!API_KEY);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Builds the upstream request body. Only whitelisted fields are forwarded so the
// prompt prefix (messages) reaches Inception exactly as the client sent it --
// prefix caching is automatic, and any change to earlier messages is a cache miss.
function buildRequest(body, stream) {
  const {
    model = DEFAULT_MODEL,
    messages,
    temperature,
    max_completion_tokens,
    reasoning_effort,
    diffusing
  } = body;

  if (!CHAT_MODELS.includes(model)) {
    throw new Error(`Unknown model "${model}". Expected one of: ${CHAT_MODELS.join(', ')}`);
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages must be a non-empty array');
  }

  const payload = { model, messages, stream };
  // Mercury accepts temperature 0.5-1.0; anything else is reset server-side with a warning.
  if (typeof temperature === 'number') payload.temperature = Math.min(1, Math.max(0.5, temperature));
  if (Number.isInteger(max_completion_tokens) && max_completion_tokens > 0) {
    payload.max_completion_tokens = max_completion_tokens;
  }
  // Omit to use the model default (mercury-3: low, mercury-2.5: medium).
  if (REASONING_EFFORTS.includes(reasoning_effort)) payload.reasoning_effort = reasoning_effort;
  if (stream) {
    // Final chunk carries usage, incl. prompt_tokens_details.cached_tokens.
    payload.stream_options = { include_usage: true };
    if (diffusing) payload.diffusing = true;
  }
  return payload;
}

app.post('/api/chat', async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: 'INCEPTION_API_KEY not set in .env file' });
  }

  let payload;
  try {
    payload = buildRequest(req.body, true);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  console.log('Request:', {
    model: payload.model,
    messages: payload.messages.length,
    reasoning_effort: payload.reasoning_effort || '(default)',
    diffusing: !!payload.diffusing
  });

  // Stop generating (and billing) if the browser goes away mid-stream.
  const controller = new AbortController();
  res.on('close', () => controller.abort());

  try {
    const response = await fetch(INCEPTION_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
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
      url: INCEPTION_API_URL
    });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    const testResponse = await fetch(`${INCEPTION_API_URL.replace('/chat/completions', '')}/models`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` }
    });
    const models = testResponse.ok ? ((await testResponse.json()).data || []).map(m => m.id) : [];
    res.json({
      status: 'ok',
      endpoint: INCEPTION_API_URL,
      modelsAvailable: testResponse.ok,
      models,
      apiKeyConfigured: !!API_KEY
    });
  } catch (error) {
    res.json({
      status: 'error',
      endpoint: INCEPTION_API_URL,
      error: error.message,
      apiKeyConfigured: !!API_KEY
    });
  }
});

app.get('/api/test', async (req, res) => {
  try {
    const payload = buildRequest({
      model: req.query.model || DEFAULT_MODEL,
      messages: [{ role: 'user', content: 'hello' }]
    }, false);
    const response = await fetch(INCEPTION_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const body = await response.json();
    res.json({
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
