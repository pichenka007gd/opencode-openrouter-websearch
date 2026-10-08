// TUI extension: adds "Websearch: plugin settings" to the command palette (Ctrl+P).
// Uses the V2 plugin TUI API (keymap.layer + promise dialogs); on older runtimes
// it falls back to a legacy palette command that points at the CLI settings script.
// OpenCode maps "@opencode/plugin" to its bundled runtime; the -ai- specifier is the npm fallback.
let Tui = null
try {
  Tui = await import("@opencode/plugin/tui")
} catch {}
if (!Tui) {
  try {
    Tui = await import("@opencode-ai/plugin/tui")
  } catch {}
}
import { readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const CONFIG_PATH = join(import.meta.dirname, "config.json")

function loadOptions() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"))
  } catch (e) {
    if (e?.code === "ENOENT") return {}
    throw new Error(`openrouter-websearch: failed to read ${CONFIG_PATH}: ${e.message}`)
  }
}

function saveOptions(options) {
  writeFileSync(CONFIG_PATH, JSON.stringify(options, null, 2) + "\n")
}

function authKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY
  const auth = JSON.parse(readFileSync(join(homedir(), ".local/share/opencode/auth.json"), "utf8"))
  return auth?.openrouter?.key
}

async function fetchModels() {
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${authKey()}` },
  })
  if (!res.ok) throw new Error(`OpenRouter models HTTP ${res.status}`)
  const { data } = await res.json()
  return data.map((m) => m.id).sort()
}

const ENGINES = [
  { title: "(default: exa via OpenRouter)", value: "" },
  { title: "exa", value: "exa" },
  { title: "native", value: "native" },
  { title: "firecrawl", value: "firecrawl" },
  { title: "parallel", value: "parallel" },
  { title: "perplexity", value: "perplexity" },
]

async function pickModel(ctx, current) {
  const models = await fetchModels()
  const value = await ctx.ui.dialog.select({
    title: "Websearch: model",
    current,
    options: models.map((m) => ({ title: m, value: m })),
  })
  return value
}

async function editSetting(ctx, key, options) {
  const current = options[key]
  switch (key) {
    case "model": {
      const v = await pickModel(ctx, current)
      if (v === undefined) return "cancelled"
      options.model = v
      break
    }
    case "maxResults":
    case "maxOutputTokens": {
      const v = await ctx.ui.dialog.prompt({
        title: `Websearch: ${key}`,
        placeholder: String(current ?? ""),
      })
      if (v === undefined) return "cancelled"
      const n = Number(v)
      if (!Number.isFinite(n) || n <= 0) {
        await ctx.ui.dialog.alert({ title: "Websearch", message: "Must be a positive number" })
        return "cancelled"
      }
      options[key] = n
      break
    }
    case "engine": {
      const v = await ctx.ui.dialog.select({
        title: "Websearch: engine",
        current,
        options: ENGINES,
      })
      if (v === undefined) return "cancelled"
      if (v === "") delete options.engine
      else options.engine = v
      break
    }
    case "summarize": {
      const v = await ctx.ui.dialog.select({
        title: "Websearch: summarize results before returning",
        current: String(current ?? true),
        options: [
          { title: "on — compact brief, saves tokens", value: true },
          { title: "off — full result contents", value: false },
        ],
      })
      if (v === undefined) return "cancelled"
      options.summarize = v
      break
    }
    case "summarizeMaxChars": {
      const v = await ctx.ui.dialog.prompt({
        title: "Websearch: max chars per result passed to the summarizer",
        placeholder: String(current ?? 1200),
      })
      if (v === undefined) return "cancelled"
      const n = Number(v)
      if (!Number.isFinite(n) || n <= 0) {
        await ctx.ui.dialog.alert({ title: "Websearch", message: "Must be a positive number" })
        return "cancelled"
      }
      options.summarizeMaxChars = n
      break
    }
    case "searchPrompt": {
      const v = await ctx.ui.dialog.prompt({ title: "Websearch: search prompt", placeholder: current ?? "" })
      if (v === undefined) return "cancelled"
      if (v.trim() === "") delete options.searchPrompt
      else options.searchPrompt = v.trim()
      break
    }
    case "includeDomains":
    case "excludeDomains": {
      const v = await ctx.ui.dialog.prompt({
        title: `Websearch: ${key}`,
        placeholder: (current ?? []).join(", "),
      })
      if (v === undefined) return "cancelled"
      const list = v.split(",").map((d) => d.trim()).filter(Boolean)
      if (list.length === 0) delete options[key]
      else options[key] = list
      break
    }
    default:
      return "unknown"
  }
  return "saved"
}

async function openSettings(ctx) {
  for (;;) {
    const options = loadOptions()
    const summary = (k) => {
      const v = options[k]
      if (Array.isArray(v)) return v.join(", ") || "(empty)"
      return String(v ?? "(default)")
    }
    const action = await ctx.ui.dialog.select({
      title: "openrouter-websearch settings",
      options: [
        { title: "model", value: "model", description: summary("model"), category: "Values" },
        { title: "maxResults", value: "maxResults", description: summary("maxResults"), category: "Values" },
        { title: "maxOutputTokens", value: "maxOutputTokens", description: summary("maxOutputTokens"), category: "Values" },
        { title: "summarize", value: "summarize", description: summary("summarize"), category: "Values" },
        { title: "summarizeMaxChars", value: "summarizeMaxChars", description: summary("summarizeMaxChars"), category: "Values" },
        { title: "engine", value: "engine", description: summary("engine"), category: "Values" },
        { title: "searchPrompt", value: "searchPrompt", description: summary("searchPrompt"), category: "Values" },
        { title: "includeDomains", value: "includeDomains", description: summary("includeDomains"), category: "Values" },
        { title: "excludeDomains", value: "excludeDomains", description: summary("excludeDomains"), category: "Values" },
      ],
    })
    if (action === undefined) return
    const result = await editSetting(ctx, action, options)
    if (result === "saved") {
      saveOptions(options)
      ctx.ui.toast.show({ message: `Saved ${action}. Restart OpenCode to apply.`, variant: "success" })
    }
  }
}

const definition = {
  id: "openrouter-websearch.tui",
  setup(ctx) {
    if (typeof ctx.keymap?.layer !== "function" || !ctx.ui?.dialog) {
      ctx.ui?.toast?.show?.({
        title: "openrouter-websearch",
        message: "TUI settings need OpenCode v2; use the CLI script for now",
      })
      return
    }
    ctx.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "openrouter-websearch.settings",
          title: "Websearch: plugin settings",
          group: "Plugins",
          palette: true,
          suggested: true,
          run: () =>
            openSettings(ctx).catch((e) =>
              ctx.ui.toast.show({ message: String(e?.message ?? e), variant: "error" }),
            ),
        },
      ],
    }))
  },
}

export default Tui?.Plugin?.define
  ? Tui.Plugin.define(definition)
  : { id: definition.id, tui: async (api) => definition.setup(api) }
