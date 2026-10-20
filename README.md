# Mercury Playground

A full-stack playground for Inception's diffusion LLMs: **Mercury 3** (default) and **Mercury 2.5**, alone or side by side.

## Features

- 🌊 **Mercury 3 + Mercury 2.5** - switch between them, or send each prompt to both side by side
- ⏱️ **Per-reply metrics** - time to first token, total time, tokens/sec, cached / reasoning tokens, estimated cost
- 💾 **Prompt caching** - each model keeps an append-only history so Inception's automatic prefix cache hits on every follow-up turn; cached tokens and hit rate are shown per model
- 🧠 **Reasoning effort** - `instant` / `low` / `medium` / `high` (or the model default: `low` for Mercury 3, `medium` for Mercury 2.5)
- 🌀 **Diffusion effect** - optional `diffusing: true` streaming that shows the text being denoised
- ⚡ **Streaming Responses** - See responses in real-time
- 📱 **Responsive UI** - Works on desktop and mobile

## Models

| | Mercury 3 (`mercury-3`) | Mercury 2.5 (`mercury-2.5`) |
|---|---|---|
| Context window | 1M | 260K |
| Max output | 131,072 | 65,536 |
| Default `reasoning_effort` | `low` | `medium` |
| Price / 1M tokens (input / cached / output) | $0.10 / $0.01 / $0.35 (launch, 50% off; regular $0.20 / $0.02 / $0.70) | $0.20 / $0.02 / $0.75 |

Source: <https://docs.inceptionlabs.ai/get-started/models>

## Prompt caching

Inception caches prompt prefixes automatically; there is no request parameter, cache key or TTL to set. Hits are reported in `usage.prompt_tokens_details.cached_tokens` and billed at the cached-input rate. To get hits, the start of each request has to be byte-identical to an earlier one, so the playground:

- puts the system prompt first and locks it until you start a new chat,
- keeps a separate history per model and only ever appends to it,
- stores each assistant reply exactly as returned,
- requests `stream_options: { include_usage: true }` so the cached-token count comes back on streamed replies.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure API access:**
   Create a `.env` file in the project root:
   ```env
   INCEPTION_API_KEY=your_api_key_here
   INCEPTION_API_URL=https://api.inceptionlabs.ai/v1/chat/completions
   ```

3. **Start the server:**
   ```bash
   npm start
   ```

4. **Open your browser:**
   Navigate to http://localhost:3000

## API Format

The backend accepts OpenAI-compatible requests:

```json
{
  "model": "mercury-3",
  "messages": [
    {"role": "user", "content": "Hello!"}
  ],
  "temperature": 1,
  "reasoning_effort": "low",
  "max_completion_tokens": 4096,
  "diffusing": false
}
```

`model` is one of `mercury-3`, `mercury-2.5`, `mercury-2`. Temperature is clamped to Mercury's 0.5–1.0 range; omitted fields use the model defaults.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `INCEPTION_API_KEY` | - | Your Inception API key |
| `INCEPTION_API_URL` | `https://api.inceptionlabs.ai/v1/chat/completions` | API endpoint |
| `PORT` | `3000` | Server port |

## Tech Stack

- **Backend:** Node.js, Express
- **Frontend:** Vanilla HTML/CSS/JS
- **API:** OpenAI-compatible format
