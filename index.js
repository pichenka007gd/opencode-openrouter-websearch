import { readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const CONFIG_PATH = join(import.meta.dirname, "config.json")

function loadFileOptions() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"))
  } catch (e) {
    if (e?.code === "ENOENT") return {}
    throw new Error(`openrouter-websearch: failed to read ${CONFIG_PATH}: ${e.message}`)
  }
}

const STATS_PATH = join(import.meta.dirname, "stats.json")

function bumpStats(delta) {
  let stats = {}
  try {
    stats = JSON.parse(readFileSync(STATS_PATH, "utf8"))
  } catch {}
  try {
    for (const [k, v] of Object.entries(delta)) stats[k] = (Number(stats[k]) || 0) + v
    writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2) + "\n")
  } catch (e) {
    console.error("openrouter-websearch: failed to update stats.json:", e?.message ?? e)
  }
  return stats
}

function num(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function readKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY
  const authPath = join(homedir(), ".local/share/opencode/auth.json")
  const auth = JSON.parse(readFileSync(authPath, "utf8"))
  const key = auth?.openrouter?.key
  if (typeof key !== "string" || !key) {
    throw new Error("OpenRouter key not found: set OPENROUTER_API_KEY or connect openrouter in OpenCode")
  }
  return key
}

async function runSearch(params, signal) {
  const {
    query,
    model,
    maxResults,
    maxOutputTokens,
    engine,
    mode,
    searchPrompt,
    includeDomains,
    excludeDomains,
  } = params

  const web = { id: "web", max_results: maxResults }
  if (engine) web.engine = engine
  if (mode) web.mode = mode
  if (searchPrompt) web.search_prompt = searchPrompt
  if (includeDomains?.length) web.include_domains = includeDomains
  if (excludeDomains?.length) web.exclude_domains = excludeDomains

  const response = await fetch("https://openrouter.ai/api/v1/responses", {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${readKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: query,
      plugins: [web],
      max_output_tokens: maxOutputTokens,
    }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`OpenRouter websearch HTTP ${response.status}: ${text.slice(0, 300)}`)
  }
  const data = await response.json()
  const results = []
  const seen = new Set()
  let answer = ""
  for (const item of data.output ?? []) {
    for (const part of item?.content ?? []) {
      if (part.type === "output_text") answer += (answer ? "\n" : "") + (part.text ?? "")
      for (const ann of part.annotations ?? []) {
        if (!ann?.url || seen.has(ann.url)) continue
        seen.add(ann.url)
        results.push({
          url: ann.url,
          title: ann.title || ann.url,
          content: ann.content ?? "",
        })
      }
    }
  }
  if (results.length === 0 && answer.trim()) {
    results.push({
      url: "https://openrouter.ai/docs/features/web-search",
      title: "OpenRouter web answer (no source annotations)",
      content: answer.trim(),
    })
  }
  return { results, answer: answer.trim(), usage: readUsage(data) }
}

const SUMMARIZE_PROMPT = `Summarize the search results below into a concise, accurate synthesis for the given question.
Rules:
- Retain every distinct fact, number, date, name, version, and exception, even if it appears only once.
- Merge repeated claims; never drop a fact just because it is rare.
- Separate verified facts from opinion or prediction; attribute disagreements to their sources instead of picking one.
- Cite each substantive claim with its source label, e.g. [2]. Never invent citations.
- Do not infer beyond the sources. If the results are insufficient, say so.
Output: one tight brief, then a short "Key facts" list and a "Conflicts/unknowns" line if any.`

function readUsage(data) {
  const u = data?.usage
  const cost = Number(u?.cost) || 0
  const searchCost = Number(u?.cost_details?.web_search) || Number(u?.cost_details?.web_search_cost) || 0
  return {
    cost,
    searchCost,
    modelCost: Math.max(0, cost - searchCost),
    inputTokens: Number(u?.input_tokens ?? u?.prompt_tokens) || 0,
    outputTokens: Number(u?.output_tokens ?? u?.completion_tokens) || 0,
  }
}

async function summarize(query, answer, results, { model, summarizeMaxChars, maxOutputTokens }, signal) {
  const body = results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${(r.content || "").slice(0, summarizeMaxChars)}`)
    .join("\n\n")
  const input = `${SUMMARIZE_PROMPT}\n\nQuestion: ${query}\n\nSearch answer:\n${answer || "(none)"}\n\nResults:\n${body}`
  const response = await fetch("https://openrouter.ai/api/v1/responses", {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${readKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input, max_output_tokens: maxOutputTokens }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`OpenRouter summarize HTTP ${response.status}: ${text.slice(0, 300)}`)
  }
  const data = await response.json()
  let brief = ""
  for (const item of data.output ?? []) {
    for (const part of item?.content ?? []) {
      if (part.type === "output_text") brief += (brief ? "\n" : "") + (part.text ?? "")
    }
  }
  return { brief: brief.trim(), usage: readUsage(data) }
}

export default {
  id: "openrouter-websearch",
  setup(ctx) {
    const opts = { ...loadFileOptions(), ...ctx.options }
    const defaults = {
      model: opts.model ?? "openai/gpt-6-luna",
      maxResults: num(opts.maxResults, 5),
      maxOutputTokens: num(opts.maxOutputTokens, 4000),
      summarize: opts.summarize ?? true,
      summarizeMaxChars: num(opts.summarizeMaxChars, 1200),
      engine: opts.engine,
      mode: opts.mode,
      searchPrompt: opts.searchPrompt,
      includeDomains: opts.includeDomains,
      excludeDomains: opts.excludeDomains,
    }

    ctx.websearch.transform((editor) => {
      editor.add({
        id: "openrouter",
        name: "OpenRouter (web plugin)",
        execute: async ({ query }, { signal }) => {
          const search = await runSearch({ ...defaults, query }, signal)
          let results = search.results
          let answer = search.answer
          bumpStats({
            calls: 1,
            searchCalls: 1,
            searchCost: search.usage.searchCost,
            modelCost: search.usage.modelCost,
            totalCost: search.usage.cost,
            inputTokens: search.usage.inputTokens,
            outputTokens: search.usage.outputTokens,
          })
          if (defaults.summarize && answer) {
            try {
              const sum = await summarize(query, answer, results, defaults, signal)
              if (sum.brief) {
                answer = sum.brief
                results = [
                  { url: results[0]?.url ?? "https://openrouter.ai", title: `Summary: ${query}`, content: sum.brief },
                  ...results.map((r) => ({ url: r.url, title: r.title, content: "" })),
                ]
              }
              bumpStats({
                summarizeCalls: 1,
                summarizeCost: sum.usage.cost,
                totalCost: sum.usage.cost,
                inputTokens: sum.usage.inputTokens,
                outputTokens: sum.usage.outputTokens,
              })
            } catch (e) {
              if (signal?.aborted) throw e
              console.error("openrouter-websearch: summarize failed, returning raw results:", e?.message ?? e)
            }
          }
          return results.map((r) => ({ ...r, time: {} }))
        },
      })
      editor.default.set("openrouter")
    })
  },
}
