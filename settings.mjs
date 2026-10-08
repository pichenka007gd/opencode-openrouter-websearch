#!/usr/bin/env node
// Interactive settings menu for the openrouter-websearch plugin.
// Usage: node settings.mjs            — interactive menu
//        node settings.mjs --show     — print current options
// Writes options into the plugin's own config.json (next to this file).

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import readline from "node:readline"

const CONFIG = join(import.meta.dirname, "config.json")

function getOptions() {
  try {
    return JSON.parse(readFileSync(CONFIG, "utf8"))
  } catch (e) {
    if (e?.code === "ENOENT") return {}
    throw new Error(`failed to read ${CONFIG}: ${e.message}`)
  }
}

function setOptions(options) {
  for (const k of ["maxResults", "maxOutputTokens", "summarizeMaxChars"]) {
    if (k in options && (!Number.isFinite(Number(options[k])) || Number(options[k]) <= 0)) {
      throw new Error(`${k} must be a positive number`)
    }
  }
  writeFileSync(CONFIG, JSON.stringify(options, null, 2) + "\n")
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
  if (!res.ok) throw new Error(`models HTTP ${res.status}`)
  const { data } = await res.json()
  return data.map((m) => m.id).sort()
}

// --- minimal TTY helpers -------------------------------------------------
const stdin = process.stdin
function keypress() {
  return new Promise((resolve) => {
    const cb = (chunk) => {
      stdin.removeListener("data", cb)
      stdin.setRawMode(false)
      resolve(chunk.toString())
    }
    stdin.setRawMode(true)
    stdin.resume()
    stdin.on("data", cb)
  })
}
function render(lines) {
  process.stdout.write("\x1b[2J\x1b[H" + lines.join("\n"))
}

async function pick(title, items, current) {
  let idx = 0
  const draw = () =>
    render([
      title,
      current !== undefined ? `current: ${current || "(not set)"}` : "",
      "",
      ...items.map((it, i) => `${i === idx ? "\x1b[36m> \x1b[0m" : "  "}${it.label}${i === idx ? "  \x1b[2m←\x1b[0m" : ""}`),
      "",
      "\x1b[2m↑/↓ — выбор, Enter — применить, Esc — отмена\x1b[0m",
    ].filter(Boolean))
  draw()
  for (;;) {
    const k = await keypress()
    if (k === "\x1b[A") idx = (idx - 1 + items.length) % items.length
    else if (k === "\x1b[B") idx = (idx + 1) % items.length
    else if (k === "\r" || k === "\n") { render([""]); return items[idx].value }
    else if (k === "\x1b") { render([""]); return undefined }
    draw()
  }
}

function ask(label, current) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: stdin, output: process.stdout })
    rl.question(`${label} [${current ?? "не задано"}]: `, (a) => { rl.close(); resolve(a.trim() === "" ? current : a.trim()) })
  })
}

async function pickModel(current) {
  let filter = ""
  for (;;) {
    let models = []
    try { models = await fetchModels() } catch (e) {
      const v = await ask("Не удалось получить список моделей (" + e.message + "). Введите ID вручную", current)
      return v
    }
    if (filter) models = models.filter((m) => m.toLowerCase().includes(filter.toLowerCase()))
    const shown = models.slice(0, 15)
    let idx = 0
    const draw = () =>
      render([
        "Модель для web-поиска (OpenRouter)",
        `current: ${current || "(not set)"}`,
        `фильтр: ${filter || "(нет)"}  \x1b[2m— печатайте для поиска\x1b[0m`,
        "",
        ...shown.map((m, i) => `${i === idx ? "\x1b[36m> \x1b[0m" : "  "}${m}`),
        "",
        `\x1b[2m${models.length} совпадений · показано ${shown.length}\x1b[0m`,
        "\x1b[2m↑/↓ — выбор, Enter — применить, Esc — оставить текущую, печать — фильтр\x1b[0m",
      ])
    draw()
    let done = false
    while (!done) {
      const k = await keypress()
      if (k === "\x1b[A") { idx = Math.max(0, idx - 1); done = true }
      else if (k === "\x1b[B") { idx = Math.min(shown.length - 1, idx + 1); done = true }
      else if (k === "\r" || k === "\n") { render([""]); return shown[idx] ?? current }
      else if (k === "\x1b") { render([""]); return current }
      else if (k === "\x7f") { filter = filter.slice(0, -1); done = true }
      else if (k >= " " && k <= "~") { filter += k; done = true }
    }
  }
}

const ENGINES = [
  { label: "(по умолчанию OpenRouter — exa)", value: undefined },
  { label: "exa", value: "exa" },
  { label: "native", value: "native" },
  { label: "firecrawl", value: "firecrawl" },
  { label: "parallel", value: "parallel" },
  { label: "perplexity", value: "perplexity" },
]

async function main() {
  const opts = getOptions()
  if (process.argv[2] === "--show") { console.log(JSON.stringify(opts, null, 2)); return }
  if (process.argv[2] === "--stats") {
    try {
      const stats = JSON.parse(readFileSync(join(import.meta.dirname, "stats.json"), "utf8"))
      const f = (v) => `$${(Number(v) || 0).toFixed(6)}`
      console.log(`calls:            ${stats.calls ?? 0}
search calls:     ${stats.searchCalls ?? 0}
summarize calls:  ${stats.summarizeCalls ?? 0}
search cost:      ${f(stats.searchCost)}
model cost:       ${f(stats.modelCost)}
summarize cost:   ${f(stats.summarizeCost)}
total cost:       ${f(stats.totalCost)}
input tokens:     ${stats.inputTokens ?? 0}
output tokens:    ${stats.outputTokens ?? 0}`)
    } catch {
      console.log("no stats yet")
    }
    return
  }

  stdin.setRawMode(false)
  console.log(`Настройки openrouter-websearch. Файл: ${CONFIG}\n`)

  for (;;) {
    const action = await pick("Что изменить?", [
      { label: "Модель", value: "model" },
      { label: "Максимум результатов (maxResults)", value: "maxResults" },
      { label: "Лимит токенов ответа (maxOutputTokens)", value: "maxOutputTokens" },
      { label: "Суммаризация вкл/выкл (summarize)", value: "summarize" },
      { label: "Лимит символов на результат для суммаризатора", value: "summarizeMaxChars" },
      { label: "Поисковый движок (engine)", value: "engine" },
      { label: "search prompt", value: "searchPrompt" },
      { label: "Включить домены (includeDomains)", value: "includeDomains" },
      { label: "Исключить домены (excludeDomains)", value: "excludeDomains" },
      { label: "Готово — выйти", value: "exit" },
    ])
    if (action === undefined || action === "exit") break
    let v
    if (action === "model") v = await pickModel(opts.model)
    else if (action === "engine") v = await pick("Поисковый движок", ENGINES, opts.engine)
    else if (action === "summarize") {
      const cur = opts.summarize ?? true
      v = await pick("Суммаризация результатов", [
        { label: "on — компактный бриф, экономит токены", value: true },
        { label: "off — полные contents результатов", value: false },
      ], String(cur))
      if (v !== undefined) v = v === true
    }
    else if (action === "summarizeMaxChars") v = Number(await ask("Символов на результат", opts.summarizeMaxChars ?? 1200))
    else if (action === "maxResults") v = Number(await ask("Число результатов", opts.maxResults))
    else if (action === "maxOutputTokens") v = Number(await ask("Токенов на ответ", opts.maxOutputTokens))
    else if (action === "searchPrompt") v = await ask("search_prompt", opts.searchPrompt)
    else if (action === "includeDomains") {
      const s = await ask("Домены через запятую (пусто = сброс)", (opts.includeDomains ?? []).join(", "))
      v = s ? s.split(",").map((d) => d.trim()).filter(Boolean) : undefined
    } else if (action === "excludeDomains") {
      const s = await ask("Домены через запятую (пусто = сброс)", (opts.excludeDomains ?? []).join(", "))
      v = s ? s.split(",").map((d) => d.trim()).filter(Boolean) : undefined
    }
    if (v === undefined) delete opts[action]
    else opts[action] = v
    setOptions(opts)
    console.log("\x1b[32mСохранено.\x1b[0m Перезапустите OpenCode, чтобы применилось.\n")
  }
  console.log("Текущие опции:", JSON.stringify(opts, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
