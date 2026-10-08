# opencode-openrouter-websearch

[![npm version](https://img.shields.io/npm/v/opencode-openrouter-websearch)](https://www.npmjs.com/package/opencode-openrouter-websearch)
[![npm downloads](https://img.shields.io/npm/dm/opencode-openrouter-websearch)](https://www.npmjs.com/package/opencode-openrouter-websearch?activeTab=versions)
[![npm total downloads](https://img.shields.io/npm/dt/opencode-openrouter-websearch)](https://npmcharts.com/compare/opencode-openrouter-websearch?minimal=true)
[![node](https://img.shields.io/node/v/opencode-openrouter-websearch)](./package.json)
[![license](https://img.shields.io/npm/l/opencode-openrouter-websearch)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/pichenka007gd/opencode-openrouter-websearch)](https://github.com/pichenka007gd/opencode-openrouter-websearch/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/pichenka007gd/opencode-openrouter-websearch)](https://github.com/pichenka007gd/opencode-openrouter-websearch/issues)
[![last commit](https://img.shields.io/github/last-commit/pichenka007gd/opencode-openrouter-websearch)](https://github.com/pichenka007gd/opencode-openrouter-websearch/commits)

OpenCode plugin: web search through the [OpenRouter web plugin](https://openrouter.ai/docs/features/web-search) (Exa by default).

## How it works

```
query ──▶ OpenRouter /api/v1/responses (model + web plugin)
              │  returns: answer + N results (full page contents)
              ▼
        [summarize: on]  second model call
              │  each result is truncated to summarizeMaxChars first
              │  prompt keeps unique facts, numbers, conflicts, [n] citations
              ▼
        agent receives: one compact brief + source list (urls only)
        [summarize: off]
              │
              ▼
        agent receives: full result contents (old behavior)
```

- **Search call** runs the configured model through OpenRouter's web plugin (Exa by default) and produces the raw answer plus results with page contents.
- **Summarize call** (only when `summarize: true`, default) sends the answer plus all results — each truncated to `summarizeMaxChars` characters — back to the model with a preservation-focused prompt: it must keep every distinct fact, number, date and exception, mark conflicts with sources, and cite claims as `[n]`. The agent then sees only the brief and the list of sources, so a typical query costs a few hundred tokens instead of several thousand.
- If the summarize call fails, the plugin logs the error and falls back to raw results — search never breaks because of summarization.

## Usage statistics

Every search appends to `stats.json` next to the plugin:

- `calls` / `searchCalls` / `summarizeCalls` — call counts
- `searchCost` — web-plugin (search) part of the cost, from OpenRouter `usage.cost_details`
- `modelCost` — rest of the search-call cost (model tokens)
- `summarizeCost` — cost of the summarization call
- `totalCost`, `inputTokens`, `outputTokens` — cumulative totals in USD / tokens

View anytime:

```sh
node settings.mjs --stats
```

## What it does

- Registers an `openrouter` provider for OpenCode's built-in `websearch` tool and sets it as the default. All agents get one clean web search tool.
- Adds a **"Websearch: plugin settings"** entry to the command palette (Ctrl+P): pick the model from the live OpenRouter list, set result/token limits, engine, search prompt, include/exclude domains.
- Ships a CLI settings script as an alternative to the TUI menu.

## Package stats

- [npm page](https://www.npmjs.com/package/opencode-openrouter-websearch) — versions, dependencies, dependents
- [Download trends](https://npmcharts.com/compare/opencode-openrouter-websearch?minimal=true) — weekly downloads over time
- [npmjs stats](https://www.npmjs.com/package/opencode-openrouter-websearch?activeTab=versions) — per-version download counts

## Install

From npm (after publish):

```jsonc
// opencode.jsonc
{
  "plugins": ["opencode-openrouter-websearch"]
}
```

From a local path:

```jsonc
{
  "plugins": [
    { "package": "/path/to/opencode-openrouter-websearch" }
  ]
}
```

Requires an OpenRouter connection (`opencode auth login` → openrouter) or `OPENROUTER_API_KEY`.

## Configuration

Stored in the plugin's own `config.json`:

```json
{
  "model": "openai/gpt-6-luna",
  "maxResults": 5,
  "maxOutputTokens": 4000,
  "engine": "exa",  "includeDomains": [],
  "excludeDomains": []
}
```

Options from the `plugins` entry in `opencode.jsonc` (`ctx.options`) override `config.json`.

| Option | Default | Meaning |
| --- | --- | --- |
| `model` | `openai/gpt-6-luna` | Model used to run the search/answer |
| `maxResults` | `5` | Max results (`web.max_results`) |
| `maxOutputTokens` | `4000` | Answer token budget |
| `engine` | provider default | `exa` \| `native` \| `firecrawl` \| `parallel` \| `perplexity` |
| `mode` | — | OpenRouter web plugin mode |
| `searchPrompt` | — | Custom search prompt |
| `summarize` | `true` | Return a compact brief instead of full contents |
| `summarizeMaxChars` | `1200` | Max chars per result fed to the summarizer |
| `includeDomains` / `excludeDomains` | — | Domain filters |

## Settings

- TUI: Ctrl+P → "Websearch: plugin settings"
- CLI: `npm run settings` in the plugin directory (or `node settings.mjs`)

Restart OpenCode after changing settings.

## Layout

- `index.js` — server plugin: websearch provider registration
- `tui.js` — TUI plugin: settings menu in the command palette
- `settings.mjs` — standalone CLI settings menu
- `config.json` — plugin configuration
