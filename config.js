// Playground configuration. Edit this file, or set the environment variables noted
// below (in .env), to change models, prices, reasoning effort values and defaults.
// The browser loads the relevant parts from GET /api/config.

const env = process.env;
const list = (value, fallback) => value ? value.split(',').map(s => s.trim()).filter(Boolean) : fallback;
const int = (value, fallback) => Number.isInteger(Number(value)) && value !== '' && value != null ? Number(value) : fallback;

module.exports = {
  // Models the server accepts. `price` is per 1M tokens (input / cached input / output),
  // used for cost estimates on Inception; OpenRouter reports the actual charge instead.
  // https://docs.inceptionlabs.ai/get-started/models (mercury-3 is at 50%-off launch pricing)
  models: {
    'mercury-3': { label: 'Mercury 3', price: { input: 0.10, cached: 0.01, output: 0.35 } },
    'mercury-2.5': { label: 'Mercury 2.5', price: { input: 0.20, cached: 0.02, output: 0.75 } },
    'mercury-2': { label: 'Mercury 2', price: { input: 0.25, cached: 0.025, output: 0.75 } }
  },

  // Models shown in the UI, in order. The first is the default for /api/test and
  // requests without a model. Side-by-side shows all of them. (PANE_MODELS)
  paneModels: list(env.PANE_MODELS, ['mercury-3', 'mercury-2.5']),

  // Mercury accepts 0.5-1.0; the server clamps to this range.
  temperature: { min: 0.5, max: 1, step: 0.05, default: 1 },

  providers: {
    inception: {
      // https://docs.inceptionlabs.ai/capabilities/reasoning-efforts (INCEPTION_REASONING_EFFORTS)
      efforts: list(env.INCEPTION_REASONING_EFFORTS, ['instant', 'low', 'medium', 'high']),
      // Pre-selected effort; '' means "Model default" (parameter omitted). (INCEPTION_DEFAULT_EFFORT)
      defaultEffort: env.INCEPTION_DEFAULT_EFFORT || '',
      diffusing: true
    },
    openrouter: {
      // `reasoning.supported_efforts` for inception/* in OpenRouter's GET /api/v1/models
      // (OPENROUTER_REASONING_EFFORTS)
      efforts: list(env.OPENROUTER_REASONING_EFFORTS, ['none', 'low', 'medium', 'high']),
      defaultEffort: env.OPENROUTER_DEFAULT_EFFORT || '',
      diffusing: false,
      // `openrouter:web_search` server tool:
      // https://openrouter.ai/docs/guides/features/server-tools/web-search
      webSearch: {
        enabled: env.OPENROUTER_WEB_SEARCH !== 'false', // OPENROUTER_WEB_SEARCH
        engine: env.OPENROUTER_WEB_SEARCH_ENGINE || 'exa', // OPENROUTER_WEB_SEARCH_ENGINE
        // Engine-specific; Exa `instant` is ~250 ms per search. (OPENROUTER_WEB_SEARCH_MODE)
        mode: env.OPENROUTER_WEB_SEARCH_MODE || 'instant',
        maxResults: int(env.OPENROUTER_WEB_SEARCH_MAX_RESULTS, 5), // 1-25 (OPENROUTER_WEB_SEARCH_MAX_RESULTS)
        engines: ['auto', 'native', 'exa', 'firecrawl', 'parallel', 'perplexity'],
        // Engines without an entry ignore `mode`.
        modes: {
          exa: ['instant', 'fast', 'auto', 'deep-lite', 'deep', 'deep-reasoning'],
          parallel: ['turbo', 'fast', 'basic', 'advanced']
        }
      }
    }
  }
};
