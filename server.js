require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const INCEPTION_API_URL = process.env.INCEPTION_API_URL || 'https://api.inceptionlabs.ai/v1/chat/completions';
const API_KEY = process.env.INCEPTION_API_KEY;

console.log('INCEPTION_API_URL:', INCEPTION_API_URL);
console.log('API_KEY configured:', !!API_KEY);

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.post('/api/chat', async (req, res) => {
  const { messages, temperature = 0.7 } = req.body;

  console.log('Request:', { messages: messages?.length, temperature });

  if (!API_KEY) {
    return res.status(500).json({ error: 'INCEPTION_API_KEY not set in .env file' });
  }

  try {
    const response = await fetch(INCEPTION_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: 'mercury-2.5',
        messages,
        temperature,
        stream: true
      })
    });

    console.log('API Response status:', response.status);

    if (!response.ok) {
      const errorBody = await response.text();
      return res.status(response.status).json({ 
        error: `API Error: ${errorBody}`,
        status: response.status
      });
    }

    // Stream response directly to client
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      res.write(chunk);
    }

    res.end();

  } catch (error) {
    console.error('Server error:', error.message);
    res.status(500).json({ 
      error: `Server error: ${error.message}`,
      url: INCEPTION_API_URL
    });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    const testResponse = await fetch(`${INCEPTION_API_URL.replace('/v1/chat/completions', '')}/models`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` }
    });
    res.json({ 
      status: 'ok', 
      endpoint: INCEPTION_API_URL,
      modelsAvailable: testResponse.ok,
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
    const response = await fetch(INCEPTION_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: 'mercury-2.5',
        messages: [{ role: 'user', content: 'hello' }],
        temperature: 0.7,
        stream: false
      })
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
