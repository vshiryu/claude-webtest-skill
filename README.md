# webtest — Claude Code skill

Browser-based **feature testing** for your own web apps (Next.js, Laravel, etc.), as a
[Claude Code](https://claude.ai/code) skill. It drives a real Chrome through the DevTools
Protocol to exercise a feature end-to-end, **automatically captures console/JS errors and
failed network requests**, runs assertions, and emits a **PASS/FAIL report** with
screenshots as evidence.

It catches the bugs a quick visual check misses: a page that *renders* fine but throws in
the console, fails a request, or whose client JS never loads.

<p align="center">
  <img src="docs/demo.png" alt="webtest run: asserts pass but a hidden JS error is caught — VERDICT FAIL" width="760">
</p>

## Why it's different from "just open a browser"

A persistent **monitor** stays attached to Chrome the whole session and records every
console error/warning, uncaught exception, failed request, and HTTP ≥ 400. Assertions plus
that event feed give you a real verdict — not just a screenshot that *looks* okay.

## Requirements

- Google Chrome / Chromium on `PATH`
- Node.js 18+
- The host must reach your app (localhost or any URL)

## Install

```bash
git clone https://github.com/vshiryu/claude-webtest-skill ~/.claude/skills/webtest
cd ~/.claude/skills/webtest && npm install
```

Claude Code auto-discovers it as the `webtest` skill. Invoke with `/webtest`, or just ask
Claude to "test feature X on http://localhost:3000".

## Usage

```bash
WT=~/.claude/skills/webtest/webtest.sh

bash "$WT" wait-up http://localhost:3000      # block until the app answers
bash "$WT" reset                              # clear error feed + report
bash "$WT" login --url=http://localhost:3000/login --user=me@x.com --pass=secret
bash "$WT" goto http://localhost:3000/clients/create
bash "$WT" fill "input[name=name]" "Test Client"
bash "$WT" clicktext "Save"
bash "$WT" assert-url "/clients"              # redirected to list
bash "$WT" assert-text "Test Client"         # new row shows up
bash "$WT" assert-no-errors                   # no console/JS/network errors
bash "$WT" report                             # -> VERDICT: PASS / FAIL
```

## Commands

| Group | Command |
|---|---|
| lifecycle | `start` · `stop` · `restart` · `status` |
| run app | `wait-up <url> [--timeout=ms]` |
| navigate | `goto <url>` · `back` · `wait <sel>` · `scroll <bottom\|top\|px>` |
| act | `click <sel>` · `clicktext <text>` · `type <sel> <text>` · `fill <sel> <text>` · `press <key>` |
| login | `login --url= --user= --pass= [--userSel= --passSel= --submitSel=]` |
| inspect | `eval <js>` · `text [sel]` · `links [filter]` · `info` · `shot [name] [--full]` |
| test | `reset` · `assert-text` · `assert-no-text` · `assert-url` · `assert-visible` · `assert-gone` · `assert-no-errors [--include4xx] [--strict]` · `events [--errors]` · `report` |

- Assertions print `✅ PASS` / `❌ FAIL`, append to the report, exit non-zero on failure,
  and auto-screenshot to `fail-<assert>.png` when they fail.
- `assert-no-errors` fails on JS exceptions, console errors, failed requests, and HTTP 5xx
  by default; `--include4xx` also counts 4xx, `--strict` also counts console warnings.

## How it works

- `webtest.sh` — lifecycle (Chrome + monitor) + CLI wrapper.
- `drive.mjs` — `puppeteer-core` driver; connects to Chrome over CDP and **never closes it**,
  so the session (cookies, tabs, page state) persists between commands.
- `monitor.mjs` — persistent CDP listener writing the console/network error feed.
- Runtime state lives in `~/.cache/claude-browser/` (`profile/`, logs, `events.jsonl`,
  `report.jsonl`, `shots/`).
- Chrome runs headless by default; `BROWSER_HEADLESS= bash webtest.sh restart` runs headful.
  Port `9222` (override with `BROWSER_PORT`).

## Notes

- For web **search**, use a search API/tool — datacenter IPs hit CAPTCHAs on Google/DDG.
  This skill is for testing *your* apps / specific URLs.
- No secrets are stored in this repo; pass credentials at runtime via `login` flags.

## License

MIT
