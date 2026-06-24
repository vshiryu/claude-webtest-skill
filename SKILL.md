---
name: webtest
description: Browser-based feature testing for the user's own web apps (Laravel/Monitrafo, Next.js, etc.). Drives a real Chrome via DevTools Protocol to exercise a feature end-to-end, automatically captures console/JS errors and failed network requests, runs assertions, and emits a PASS/FAIL report with screenshots as evidence. Use to verify that a change/feature built in this session actually works in the browser — manual E2E / smoke testing. The app may already be running (user gives a URL) or you may need to start it first. NOT for generic web browsing or web search (use WebSearch for search; this host's datacenter IP hits CAPTCHAs on Google/DDG).
---

# webtest — verify features in a real browser

Drives the system Chrome through CDP to **test features of the user's web apps**. A
background **monitor** stays attached to Chrome and records every console error/warning,
uncaught JS exception, failed request, and HTTP ≥400 to an event feed — so a feature that
"looks fine" but throws in the console is caught. Assertions + the event feed produce a
**PASS/FAIL report** with screenshots.

Everything goes through one wrapper:

```bash
WT=~/.claude/skills/webtest/webtest.sh
bash "$WT" <command> [args] [--flags]
```

## What to test comes from the session

Usually you're verifying **the change just built in this conversation**. Derive the test
steps and expected outcomes from that context — don't ask the user to script it. The user
will either tell you the running URL or ask you to start the app.

## Standard flow

1. **Get the app running.**
   - If the user gave a URL, use it.
   - If asked to start it: launch the project's dev server (its documented dev command, or
     the `/run` skill), then `bash "$WT" wait-up http://localhost:PORT` to block until it answers.
2. **`reset`** — clears the event feed + report so the run is clean:
   `bash "$WT" reset`
3. **Drive the feature** — `goto`, `login` (if needed), then `click`/`clicktext`/`type`/
   `fill`/`press` to exercise exactly the new behavior.
4. **Assert outcomes** — `assert-text`, `assert-url`, `assert-visible`, `assert-gone`,
   `assert-no-text`.
5. **`assert-no-errors`** — fail if the monitor caught console errors / JS exceptions /
   network failures during the run. This is what separates "renders" from "works".
6. **`report`** — prints `Asserts: N PASS / M FAIL`, lists captured errors, and a final
   `VERDICT`. Then **Read the screenshots** (esp. `fail-*.png`) and present verdict + evidence.

## Commands

| Group | Command |
|---|---|
| lifecycle | `start` · `stop` · `restart` · `status` |
| run app | `wait-up <url> [--timeout=ms]` (poll until the server answers) |
| navigate | `goto <url>` · `back` · `wait <sel> [--timeout=ms]` · `scroll <bottom\|top\|px>` |
| act | `click <sel>` · `clicktext <text>` · `type <sel> <text>` · `fill <sel> <text>` · `press <key>` |
| login | `login --url= --user= --pass= [--userSel= --passSel= --submitSel=]` |
| inspect | `eval <js>` · `text [sel] [--max=N]` · `links [filter]` · `info` · `shot [name] [--full]` |
| **test** | `reset` · `assert-text <t>` · `assert-no-text <t>` · `assert-url <substr>` · `assert-visible <sel>` · `assert-gone <sel>` · `assert-no-errors [--include4xx] [--strict]` · `events [--errors]` · `report` |

- Assertions print `✅ PASS` / `❌ FAIL`, append to the report, exit non-zero on failure,
  and auto-screenshot to `fail-<assert>.png` when they fail.
- `assert-no-errors` fails on JS exceptions, console errors, failed requests, and HTTP 5xx
  by default. Add `--include4xx` (count 4xx too) or `--strict` (also count console warnings).
- `events` shows the captured problem feed (`--errors` = only the failure-worthy ones).

## Example — verify a new "create client" form

```bash
WT=~/.claude/skills/webtest/webtest.sh
bash "$WT" wait-up http://localhost:8000          # app booted elsewhere
bash "$WT" reset
bash "$WT" login --url=http://localhost:8000/login --user=admin@x.com --pass=secret
bash "$WT" goto http://localhost:8000/clients/create
bash "$WT" fill "input[name=name]" "Cliente Teste"
bash "$WT" clicktext "Salvar"
bash "$WT" assert-url "/clients"                  # redirected to list
bash "$WT" assert-text "Cliente Teste"            # new row shows up
bash "$WT" assert-no-errors                       # no console/network errors
bash "$WT" report                                 # -> VERDICT: PASS/FAIL
# then Read the SHOT paths / fail-*.png to show evidence
```

## Gotchas

- **Search engines block this IP** (datacenter) → for web *search* use the WebSearch tool,
  not this. This skill is for the user's own apps / specific URLs.
- **Headless by default.** To watch it on `$DISPLAY`: `BROWSER_HEADLESS= bash webtest.sh restart`.
- **Session persists** across commands (cookies in the profile) — log in once, reuse it.
- **`reset` before each run**, or stale errors/asserts pollute the report.
- **Complex JS in `eval`**: pass a single expression, or `eval "$(cat snippet.js)"`.
- Internal links often render as absolute URLs → use `a[href*="..."]`, not `^=`.

## Internals

- `webtest.sh` — lifecycle (Chrome + monitor) + delegates to the driver.
- `drive.mjs` — puppeteer-core driver (connects via CDP, never closes Chrome).
- `monitor.mjs` — persistent CDP listener writing the error/network feed.
- Runtime: `~/.cache/claude-browser/` → `profile/`, `chrome.log`, `monitor.log`,
  `events.jsonl` (problem feed), `report.jsonl` (assert results), `shots/` (PNGs).
- Port `9222` (override `BROWSER_PORT`). Deps in skill dir; if missing: `npm install` there.
