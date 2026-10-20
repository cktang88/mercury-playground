# Mercury Playground

A small full-stack playground for Inception's diffusion LLMs. **Mercury 3** is the default. You can also chat with **Mercury 2.5**, or send every prompt to both and compare them side by side.

## Features

- 🌊 **Mercury 3 + Mercury 2.5**: switch between them, or send each prompt to both side by side
- ⏱️ **Per-reply metrics**: time to first token, total time, tokens/sec, input / cached / output / reasoning tokens, estimated cost
- 📊 **Session totals per model**: requests, tokens, cache hit rate, estimated cost
- 💾 **Prompt caching**: each model keeps an append-only history, so Inception's automatic prefix cache hits on every follow-up turn (see [Prompt caching](#prompt-caching))
- 🧠 **Reasoning effort**: `instant` / `low` / `medium` / `high`, or the model's default
- 🌀 **Diffusion effect**: optional `diffusing: true` streaming that shows the text being denoised
- ⚡ **Streaming responses** over server-sent events
- 📱 **Responsive UI**: on narrow screens the two models stack vertically

## Models

| | Mercury 3 (`mercury-3`) | Mercury 2.5 (`mercury-2.5`) |
|---|---|---|
| Released | Oct 2026 | |
| Context window | 1M tokens | 260K tokens |
| Max output (`max_completion_tokens`) | 131,072 | 65,536 |
| Default output budget | 24,576 (8,192 at `instant`, 65,536 at `medium`, 131,072 at `high`) | 16,384 (65,536 at `high`) |
| Default `reasoning_effort` | `low` | `medium` |
| Temperature | 0.5–1.0, default 1 | 0.5–1.0, default 1 |
| Price per 1M tokens (input / cached input / output) | $0.10 / $0.01 / $0.35 at 50%-off launch pricing (regularly $0.20 / $0.02 / $0.70) | $0.20 / $0.02 / $0.75 |

Both support tool calling and structured outputs through the same OpenAI-compatible `/v1/chat/completions` endpoint. The playground doesn't use either feature. The server also accepts `mercury-2`, but the UI doesn't show it.

Sources: [Models](https://docs.inceptionlabs.ai/get-started/models), [Reasoning efforts](https://docs.inceptionlabs.ai/capabilities/reasoning-efforts), [API reference](https://api.inceptionlabs.ai/openapi.json). Check these for current pricing, because the Mercury 3 launch discount is temporary.

## Setup

Requires Node.js 18 or newer, because the server uses the built-in `fetch`.

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure API access.** Get a key from the [Inception Platform dashboard](https://platform.inceptionlabs.ai/dashboard/api-keys), then:
   ```bash
   cp .env.example .env
   # edit .env and set INCEPTION_API_KEY
   ```
   The key stays on the server and is never sent to the browser. `.env` is git-ignored.

3. **Start the server:**
   ```bash
   npm start
   ```

4. **Open** http://localhost:3000

## Using the playground

- **View toggle** (top right): *Mercury 3*, *Mercury 2.5*, or *Side by side*. In side-by-side mode each prompt goes to both models in parallel. In single-model mode it goes only to the model you're viewing.
- **New chat** clears both conversations and unlocks the system prompt.
- **Settings** (right sidebar):
  - *System prompt*: sent as the first message. It is locked once a chat starts, because changing it would invalidate the prompt cache.
  - *Reasoning effort*: "Model default" omits the parameter, so each model uses its own default.
  - *Temperature*: 0.5–1.0, Mercury's supported range.
  - *Max completion tokens*: leave blank for the model default.
  - *Diffusion effect*: streams the full text at each denoising step instead of appending tokens.
- **Stats line** under each pane (latest reply): TTFT, total time, end-to-end tokens/sec (completion tokens ÷ total time, reasoning included), input tokens and how many were cached, output tokens and reasoning tokens, and estimated cost.
- **Session usage** (sidebar): running totals per model, including cache hit rate (cached ÷ prompt tokens).

Each model has its own conversation history. Switching to single-model view and chatting means the other model misses those turns. Use *New chat* if you want both histories to match again.

Costs are estimates, calculated in the browser from the per-token prices in `public/app.js`. Update `MODELS` there if pricing changes.

## Prompt caching

Inception caches prompt prefixes automatically. There is no request parameter, cache key, or documented TTL, and no way to pin or invalidate entries ([FAQ](https://docs.inceptionlabs.ai/resources/faq)). Cache hits are reported in `usage.prompt_tokens_details.cached_tokens` and billed at the model's cached-input rate, about 10× cheaper than regular input.

A hit requires the beginning of the request to match an earlier request byte for byte. The playground keeps prefixes stable in these ways:

- **The system prompt comes first and is locked** for the whole chat.
- **Each model keeps a separate, append-only history.** Earlier messages are never edited or reordered, and one model's replies never go into the other's history.
- **Assistant replies are stored exactly as returned.** In diffusing mode, that means the final full-text chunk.
- **Failed turns are rolled back.** The unanswered user message is removed, so the history stays a valid prefix.
- **The server forwards `messages` untouched.** It whitelists fields but never rewrites message content.
- **Usage is requested on streams** with `stream_options: { include_usage: true }`, so the cached-token count comes back on streamed replies.

On a multi-turn chat, every turn after the first should show most of its input tokens as cached.

## Server API

### `POST /api/chat`

This endpoint proxies to Inception's chat completions with `stream: true`. The request body looks like this:

```json
{
  "model": "mercury-3",
  "messages": [
    {"role": "system", "content": "You are terse."},
    {"role": "user", "content": "Hello!"}
  ],
  "temperature": 1,
  "reasoning_effort": "low",
  "max_completion_tokens": 4096,
  "diffusing": false
}
```

| Field | Required | Notes |
|---|---|---|
| `model` | no | `mercury-3` (default), `mercury-2.5`, or `mercury-2`. Any other value returns `400`. |
| `messages` | yes | Non-empty OpenAI-style message array, forwarded as is |
| `temperature` | no | Clamped to 0.5–1.0 |
| `reasoning_effort` | no | `instant` \| `low` \| `medium` \| `high`. Other values are dropped, so the model default applies. |
| `max_completion_tokens` | no | Positive integer. Omit it to use the model default. |
| `diffusing` | no | `true` makes each streamed chunk carry the full text so far |

Other fields are ignored. The response is Inception's SSE stream, passed through byte for byte:

- `data: {...}` chunks whose text is in `choices[0].delta.content`
- a final chunk with `"choices": []` and a populated `usage` object (`prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens`)
- then `data: [DONE]`

Upstream errors are returned as JSON `{ "error": "...", "status": <code> }` with the upstream status code. If the browser disconnects mid-stream, the server aborts the upstream request.

### `GET /api/health`

Calls Inception's `/v1/models` endpoint and returns:

```json
{ "status": "ok", "endpoint": "...", "modelsAvailable": true, "models": ["mercury-3", "mercury-2.5", "..."], "apiKeyConfigured": true }
```

The UI polls this every 30 seconds and warns if `mercury-3` or `mercury-2.5` is missing from the list.

### `GET /api/test?model=mercury-3`

Sends one non-streaming "hello" request to the given model (default `mercury-3`) and returns the raw upstream response. Use it for quick debugging from the command line:

```bash
curl 'http://localhost:3000/api/test?model=mercury-2.5'
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `INCEPTION_API_KEY` | – | Your Inception API key (required) |
| `INCEPTION_API_URL` | `https://api.inceptionlabs.ai/v1/chat/completions` | Chat completions endpoint. `/api/health` derives the `/v1/models` URL from it. |
| `PORT` | `3000` | Server port |

## Project structure

```
server.js           Express server: /api/chat proxy, /api/health, /api/test
public/index.html   Layout: view toggle, model panes, settings and usage sidebar
public/app.js       Per-model histories, SSE parsing, metrics, cost and cache stats
public/styles.css   Dark theme, single and side-by-side layouts
.env.example        Template for .env
```

## Troubleshooting

- **"No API key"** in the status card: `.env` is missing or `INCEPTION_API_KEY` is empty. Restart the server after editing it.
- **"API ready (missing: …)"**: your key doesn't have access to that model, or it isn't listed by `/v1/models`.
- **Cached tokens stay at 0**: the first turn of a chat is never cached. If later turns also show 0, the prompt may be too short to cache, or the cache entry has expired. Inception documents no minimum length or TTL.
- **`warning` in the response about temperature**: you sent a value outside 0.5–1.0 directly to Inception. The playground server clamps it for you.

## Tech Stack

- **Backend:** Node.js, Express
- **Frontend:** vanilla HTML/CSS/JS, no build step
- **API:** Inception's OpenAI-compatible chat completions
