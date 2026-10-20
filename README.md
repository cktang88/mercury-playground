# Mercury Playground

A small full-stack playground for Inception's diffusion LLMs. **Mercury 3** is the default. You can also chat with **Mercury 2.5**, or send every prompt to both and compare them side by side.

It works with either an **Inception** API key or an **OpenRouter** API key (see [Providers](#providers)).

## Features

- 🌊 **Mercury 3 + Mercury 2.5**: switch between them, or send each prompt to both side by side
- 🔑 **Inception or OpenRouter**: uses whichever key you provide
- ⏱️ **Per-reply metrics**: time to first token, total time, tokens/sec, input / cached / output / reasoning tokens, estimated cost
- 📊 **Session totals per model**: requests, tokens, cache hit rate, estimated cost
- 💾 **Prompt caching**: each model keeps an append-only history, so Inception's automatic prefix cache hits on every follow-up turn (see [Prompt caching](#prompt-caching))
- 🧠 **Reasoning effort**: `instant` / `low` / `medium` / `high`, or the model's default
- 🌀 **Diffusion effect**: optional `diffusing: true` streaming that shows the text being denoised (Inception only)
- 🔎 **Web search** (OpenRouter only): OpenRouter's `openrouter:web_search` tool, using Exa in `instant` mode by default, with source links under each reply
- ⚙️ **Configurable**: models, prices, effort values and defaults, temperature range, and web search defaults all live in `config.js`, with env-var overrides
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

Both support tool calling and structured outputs through the same OpenAI-compatible `/v1/chat/completions` endpoint. The playground doesn't use tool calling directly. On OpenRouter, it adds OpenRouter's web search tool (see [Web search](#web-search-openrouter)). `config.js` also lists `mercury-2`, so the server accepts it, but it isn't shown unless you add it to `PANE_MODELS`.

Sources: [Models](https://docs.inceptionlabs.ai/get-started/models), [Reasoning efforts](https://docs.inceptionlabs.ai/capabilities/reasoning-efforts), [API reference](https://api.inceptionlabs.ai/openapi.json). Check these for current pricing, because the Mercury 3 launch discount is temporary. Prices on OpenRouter can differ; see [Providers](#providers).

## Providers

The server picks a provider at startup:

1. If `INCEPTION_API_KEY` is set, it calls Inception directly.
2. Otherwise, if `OPENROUTER_API_KEY` is set, it calls OpenRouter.
3. If neither is set, the UI shows "No API key" and chat requests return `500`.

The startup log and the header ("via Inception" / "via OpenRouter") show which provider is active. On OpenRouter, Inception is the only provider for both models, so requests still run on Inception's servers.

| | Inception (direct) | OpenRouter |
|---|---|---|
| Endpoint | `https://api.inceptionlabs.ai/v1/chat/completions` | `https://openrouter.ai/api/v1/chat/completions` |
| Model ids sent | `mercury-3`, `mercury-2.5` | `inception/mercury-3`, `inception/mercury-2.5` |
| Reasoning effort values | `instant`, `low`, `medium`, `high` | `none`, `low`, `medium`, `high` |
| How effort is sent | `reasoning_effort` | `reasoning: { effort }` |
| Default effort when omitted | Mercury 3: `low`; Mercury 2.5: `medium` | OpenRouter lists `medium` as `default_effort` for both |
| Diffusion effect (`diffusing`) | ✅ | ❌ (not a supported OpenRouter parameter, so the toggle is disabled) |
| Web search | ❌ | ✅ `openrouter:web_search` server tool |
| Usage in stream | Requested with `stream_options.include_usage` | Always included. `stream_options` is deprecated there, so it isn't sent. |
| Cost shown | Estimate from the list prices in `config.js` | Actual charge from `usage.cost`, including web searches |
| Caching | Automatic prefix caching | Implicit caching (`supports_implicit_caching: true`), plus a per-conversation `session_id` for sticky routing |

At the time of writing, OpenRouter's catalog lists Mercury 3 at $0.10 / $0.01 / $0.35 per 1M tokens (input / cached / output). It lists Mercury 2.5 at a discounted $0.04 / $0.004 / $0.15. Check the live prices on [openrouter.ai/inception](https://openrouter.ai/inception).

Sources: [OpenRouter models API](https://openrouter.ai/api/v1/models), [Reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), [Usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting), [Streaming](https://openrouter.ai/docs/api_reference/streaming), [Prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching), [Chat completions reference](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion).

## Setup

Requires Node.js 18 or newer, because the server uses the built-in `fetch`.

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure API access.** You need one of these keys:
   - an Inception key from the [Inception Platform dashboard](https://platform.inceptionlabs.ai/dashboard/api-keys), or
   - an OpenRouter key from [openrouter.ai/keys](https://openrouter.ai/keys)

   Then run:
   ```bash
   cp .env.example .env
   # edit .env and set INCEPTION_API_KEY or OPENROUTER_API_KEY
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
  - *Reasoning effort*: "Model default" omits the parameter, so each model uses its own default. The list of options depends on the provider (see [Providers](#providers)).
  - *Temperature*: 0.5–1.0, Mercury's supported range.
  - *Max completion tokens*: leave blank for the model default.
  - *Diffusion effect*: streams the full text at each denoising step instead of appending tokens. It is disabled when using OpenRouter.
- **Web search** (sidebar, OpenRouter only): on/off, engine, mode, and max results. These are locked once a chat starts, like the system prompt.
- **Stats line** under each pane (latest reply): TTFT, total time, end-to-end tokens/sec (completion tokens ÷ total time, reasoning included), input tokens and how many were cached, output tokens and reasoning tokens, number of web searches (if any), and cost.
- **Session usage** (sidebar): running totals per model, including cache hit rate (cached ÷ prompt tokens).

Each model has its own conversation history. Switching to single-model view and chatting means the other model misses those turns. Use *New chat* if you want both histories to match again.

On OpenRouter, cost is the amount OpenRouter reports it charged (`usage.cost`). On Inception, cost is an estimate calculated in the browser from the per-token prices in `config.js`. Update them there if pricing changes.

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

**Via OpenRouter**, the same rules apply, and OpenRouter reports cache hits in the same `prompt_tokens_details.cached_tokens` field. Each model pane also gets a random `session_id` per chat (regenerated by *New chat*). OpenRouter uses it as the sticky-routing key, so every turn of a conversation goes to the same provider endpoint and finds its cache. OpenRouter's docs say sticky sessions expire after 10 minutes of inactivity. The `session_id` also groups the turns in OpenRouter's Logs → Sessions view.

## Web search (OpenRouter)

When the provider is OpenRouter, each request includes OpenRouter's [`openrouter:web_search` server tool](https://openrouter.ai/docs/guides/features/server-tools/web-search). The defaults are:

```json
{ "type": "openrouter:web_search", "parameters": { "engine": "exa", "mode": "instant", "max_results": 5 } }
```

- **The model decides** whether to search, and it may search zero or more times per reply. OpenRouter runs each search and feeds the results back to the model within the same request.
- **Exa `instant` mode** is Exa's fastest mode (about 250 ms per search, according to OpenRouter). It costs $0.007 per search, including up to 10 results. Other options are listed in the table below.
- **Searches are counted** in the stats line from `usage.server_tool_use_details.web_search_requests`. They are included in OpenRouter's `usage.cost`.
- **Sources:** if the response carries `url_citation` annotations, the UI lists them as links under the reply. OpenRouter documents this annotation format for web results, but its Chat Completions streaming schema doesn't list an `annotations` field. The UI reads it from `delta.annotations` or `message.annotations` when present, and shows nothing otherwise.
- **Prompt caching:** the tool definition is part of the request, so the web search settings are locked for the duration of a chat. Search results become part of that turn's request, and the playground only stores the model's final reply in the history. That means cached-token counts on the turn after a search may be lower than on chats without search.

| Engine | Modes | Notes |
|---|---|---|
| `exa` (default) | `instant` (default), `fast`, `auto`, `deep-lite`, `deep`, `deep-reasoning` | $0.007 per search for instant/fast/auto, more for deep modes |
| `parallel` | `turbo`, `fast`, `basic`, `advanced` | OpenRouter defaults to `basic` |
| `auto` | – | Native provider search if available, otherwise Exa |
| `native`, `firecrawl`, `perplexity` | – | See OpenRouter's docs for behavior and pricing |

Turn search off in the sidebar or with `OPENROUTER_WEB_SEARCH=false`. Inception's API has no equivalent, so the web search card is hidden when the provider is Inception.

## Configuration

All tunables are in [`config.js`](config.js). The server reads it at startup and the UI loads it from `GET /api/config`. You can edit the file, or override the common settings in `.env`:

| Setting | Env var | Default |
|---|---|---|
| Models shown, in order. The first is the default model. | `PANE_MODELS` (comma-separated) | `mercury-3,mercury-2.5` |
| Model labels and prices | (edit `models` in `config.js`) | Inception list prices |
| Temperature range and default | (edit `temperature`) | 0.5–1.0, default 1 |
| Inception effort values | `INCEPTION_REASONING_EFFORTS` | `instant,low,medium,high` |
| Inception pre-selected effort (`''` = model default) | `INCEPTION_DEFAULT_EFFORT` | `''` |
| OpenRouter effort values | `OPENROUTER_REASONING_EFFORTS` | `none,low,medium,high` |
| OpenRouter pre-selected effort | `OPENROUTER_DEFAULT_EFFORT` | `''` |
| Web search on by default | `OPENROUTER_WEB_SEARCH` | `true` (set `false` to disable) |
| Web search engine | `OPENROUTER_WEB_SEARCH_ENGINE` | `exa` |
| Web search mode | `OPENROUTER_WEB_SEARCH_MODE` | `instant` |
| Web search max results per search (1–25) | `OPENROUTER_WEB_SEARCH_MAX_RESULTS` | `5` |
| Allowed search engines and modes per engine | (edit `webSearch.engines` / `webSearch.modes`) | OpenRouter's documented values |

The server only forwards effort values, engines and modes listed in the config. Values that aren't listed are dropped (effort) or rejected with `400` (engine or mode). So if Inception or OpenRouter adds a new value, add it to the config to use it.

## Server API

### `POST /api/chat`

This endpoint proxies to the active provider's chat completions with `stream: true`. The request body looks like this:

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
  "diffusing": false,
  "session_id": "6f1c…",
  "web_search": { "enabled": true, "engine": "exa", "mode": "instant", "max_results": 5 }
}
```

| Field | Required | Notes |
|---|---|---|
| `model` | no | Any model in `config.js` (default: the first entry in `PANE_MODELS`). Any other value returns `400`. |
| `messages` | yes | Non-empty OpenAI-style message array, forwarded as is |
| `temperature` | no | Clamped to 0.5–1.0 |
| `reasoning_effort` | no | One of the active provider's configured effort values (by default, Inception: `instant` \| `low` \| `medium` \| `high`; OpenRouter: `none` \| `low` \| `medium` \| `high`). Other values are dropped, so the model default applies. |
| `max_completion_tokens` | no | Positive integer. Omit it to use the model default. |
| `diffusing` | no | `true` makes each streamed chunk carry the full text so far. Inception only; ignored on OpenRouter. |
| `session_id` | no | Up to 256 characters. Forwarded to OpenRouter for sticky routing; ignored on Inception. |
| `web_search` | no | OpenRouter only. `{ enabled, engine, mode, max_results }`; omitted fields use the config defaults. Unknown engine or mode returns `400`. Ignored on Inception. |

Other fields are ignored. The response is the provider's SSE stream, passed through byte for byte:

- `data: {...}` chunks whose text is in `choices[0].delta.content`
- a final chunk with a populated `usage` object (`prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens`, plus `cost` on OpenRouter). Inception sends `"choices": []` on this chunk; OpenRouter sends one choice with an empty `delta`.
- then `data: [DONE]`

OpenRouter may also send `: OPENROUTER PROCESSING` comment lines, which clients should skip. If an error happens after the stream has started, OpenRouter sends a chunk with a top-level `error` object; the UI shows it as a failed request.

Upstream errors are returned as JSON `{ "error": "...", "status": <code> }` with the upstream status code. If the browser disconnects mid-stream, the server aborts the upstream request.

### `GET /api/config`

Returns the settings the UI is built from: the active provider, the shown models with their labels and prices, the temperature range, the provider's effort values and pre-selected effort, whether diffusing is supported, and the web search settings (`null` on Inception).

```json
{
  "provider": "OpenRouter",
  "models": [{ "id": "mercury-3", "label": "Mercury 3", "price": { "input": 0.1, "cached": 0.01, "output": 0.35 } }, "…"],
  "temperature": { "min": 0.5, "max": 1, "step": 0.05, "default": 1 },
  "efforts": ["none", "low", "medium", "high"],
  "defaultEffort": "",
  "diffusing": false,
  "webSearch": { "enabled": true, "engine": "exa", "mode": "instant", "maxResults": 5, "engines": ["…"], "modes": { "exa": ["…"], "parallel": ["…"] } }
}
```

### `GET /api/health`

Calls the provider's `/models` endpoint. On OpenRouter it also calls `/key` to check the key, because `/models` there is public. It returns:

```json
{
  "status": "ok",
  "provider": "OpenRouter",
  "endpoint": "https://openrouter.ai/api/v1/chat/completions",
  "apiKeyConfigured": true,
  "modelsAvailable": true,
  "models": ["mercury-3", "mercury-2.5", "mercury-2"]
}
```

`models` contains the configured model ids that the provider serves, without the `inception/` prefix. The UI polls this every 30 seconds and warns if a shown model is missing.

### `GET /api/test?model=mercury-3`

Sends one non-streaming "hello" request to the given model (default: the first entry in `PANE_MODELS`) and returns the raw upstream response. On OpenRouter it uses the default web search settings. Use it for quick debugging from the command line:

```bash
curl 'http://localhost:3000/api/test?model=mercury-2.5'
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `INCEPTION_API_KEY` | – | Inception API key. Takes priority if both keys are set. |
| `OPENROUTER_API_KEY` | – | OpenRouter API key. Used when no Inception key is set. |
| `INCEPTION_API_URL` | `https://api.inceptionlabs.ai/v1/chat/completions` | Inception chat completions endpoint. `/api/health` derives the `/models` URL from it. |
| `OPENROUTER_API_URL` | `https://openrouter.ai/api/v1/chat/completions` | OpenRouter chat completions endpoint. `/models` and `/key` URLs are derived from it. |
| `PORT` | `3000` | Server port |

See [Configuration](#configuration) for the model, effort and web search variables.

## Project structure

```
config.js           Models, prices, effort values, temperature range, web search defaults
server.js           Express server: provider selection, /api/chat proxy, /api/config, /api/health, /api/test
public/index.html   Layout: view toggle, model panes, settings and usage sidebar
public/app.js       Builds the UI from /api/config; per-model histories, SSE parsing, metrics, citations
public/styles.css   Dark theme, single and side-by-side layouts
.env.example        Template for .env
```

## Troubleshooting

- **"No API key"** in the status card: `.env` is missing, or both `INCEPTION_API_KEY` and `OPENROUTER_API_KEY` are empty. Restart the server after editing it.
- **Wrong provider in use**: Inception wins whenever `INCEPTION_API_KEY` is set. Clear it to use OpenRouter.
- **OpenRouter `402`**: the key is out of credits or has hit its credit limit.
- **"API ready (missing: …)"**: your key doesn't have access to that model, or it isn't listed by `/v1/models`.
- **Cached tokens stay at 0**: the first turn of a chat is never cached. If later turns also show 0, the prompt may be too short to cache, or the cache entry has expired. Inception documents no minimum length or TTL.
- **Web search never runs**: the model decides when to search, so ask something that needs current information. Also check that search is enabled in the sidebar, and that the provider is OpenRouter.
- **`400 Unknown … search mode`**: the mode isn't valid for the selected engine. Check `webSearch.modes` in `config.js`.
- **`warning` in the response about temperature**: you sent a value outside 0.5–1.0 directly to Inception. The playground server clamps it for you.

## Tech Stack

- **Backend:** Node.js, Express
- **Frontend:** vanilla HTML/CSS/JS, no build step
- **API:** OpenAI-compatible chat completions from Inception or OpenRouter
