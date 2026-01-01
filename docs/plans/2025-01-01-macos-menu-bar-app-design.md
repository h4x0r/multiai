# FreeTier macOS Menu Bar App Design

**Date:** 2025-01-01
**Status:** Approved
**Author:** Claude + Human collaboration

## Overview

FreeTier is a local API gateway for free LLMs. This design covers the macOS menu bar application with a Charles Proxy/ZAP-style traffic inspector.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     freetier (single binary)                     │
├─────────────────────────────────────────────────────────────────┤
│  Subcommands:                                                    │
│    freetier serve    → Headless gateway (CLI, terminal logs)    │
│    freetier app      → Menu bar app with Tauri UI               │
│    freetier version  → Version info                             │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                         Core Library                              │
├──────────────────────────────────────────────────────────────────┤
│  scanner.rs      → Free model discovery (OpenRouter, Zen)        │
│  inspector.rs    → Traffic capture with HAR export               │
│  api.rs          → OpenAI-compatible endpoints                   │
│  config.rs       → Settings management (TOML file)               │
│  logger.rs       → Terminal logging (minimal/compact/verbose)    │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                    Tauri Menu Bar App                             │
├──────────────────────────────────────────────────────────────────┤
│  src-tauri/      → Rust Tauri backend                            │
│  ui/             → SolidJS + Tailwind CSS                        │
│    - Traffic inspector (list + detail panels)                    │
│    - Settings dialog                                             │
│    - Session management                                          │
└──────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Core | Rust + Axum | Existing codebase, performance |
| Desktop | Tauri 2.0 | Native menu bar, small bundle |
| Frontend | SolidJS + Tailwind | 7KB bundle, fine-grained reactivity |
| Table | @tanstack/solid-table | Virtual scrolling for 1000+ rows |
| Syntax | CodeMirror | JSON highlighting |

## Configuration

**File:** `~/.config/freetier/config.toml`

```toml
[gateway]
port = 8080
auto_start = true

[api_keys]
openrouter = ""
opencode_zen = ""

[logging]
enabled = true
folder = "~/.local/share/freetier/logs"
format = "har"
retention_days = 30

[inspector]
max_transactions = 1000
clear_on_restart = false

[app]
start_at_login = false
log_verbosity = "compact"
```

## UI Design

### Menu Bar Dropdown

```
┌─────────────────────────────┐
│  FreeTier                   │
├─────────────────────────────┤
│  ● Running on :8080         │
│    47 requests captured     │
├─────────────────────────────┤
│  ■ Stop Gateway        ⌘S   │
│  Open Inspector...     ⌘I   │
│  Preferences...        ⌘,   │
├─────────────────────────────┤
│  Copy Endpoint         ⌘C   │
│  Open Logs Folder           │
├─────────────────────────────┤
│  Check for Updates...       │
│  About FreeTier             │
│  Quit                  ⌘Q   │
└─────────────────────────────┘
```

### Traffic Inspector Window

```
┌─────────────────────────────────────────────────────────────────────┐
│  FreeTier Inspector                              [Filter...] [⚙️]   │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─ Toolbar ─────────────────────────────────────────────────────┐  │
│  │ [▼ All Methods] [▼ Status] [▼ Model]  │🔍 Filter...│ [↓ Export]│ │
│  └───────────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────┐ ┌────────────────────────────────┐ │
│  │ #    Time     Method  URL  │ │  [Request] [Response] [Timing] │ │
│  │─────────────────────────────│ ├────────────────────────────────┤ │
│  │ 42  12:04  POST  /v1/ch... │ │  Headers:                      │ │
│  │ 41  12:03  POST  /v1/ch... │ │    Authorization: Bearer ***   │ │
│  │ 40  12:02  GET   /v1/mo... │ │    Content-Type: application/..│ │
│  │ 39  12:01  POST  /v1/ch... │ │                                │ │
│  │                             │ │  Body:                         │ │
│  │                             │ │  {                             │ │
│  │                             │ │    "model": "grok-code-fast-1" │ │
│  │                             │ │    "messages": [...]           │ │
│  │                             │ │  }                             │ │
│  ├─────────────────────────────┤ ├────────────────────────────────┤ │
│  │ [Clear] [Export HAR] [Save] │ │ [Copy cURL▼] [Replay] [Diff]   │ │
│  └─────────────────────────────┘ └────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### Settings Dialog

**Tabs:**
1. **Gateway** - Port, auto-start, start at login, endpoint display
2. **Providers** - API keys table with status indicators (stored in Keychain)
3. **Logging** - Enable toggle, folder picker, format, retention slider
4. **Advanced** - Max transactions, clear on restart

## Features

### Traffic Inspector
- [x] Request list with virtual scrolling
- [x] Column sorting and filtering
- [x] Color-coded status (🟢2xx, 🟡3xx, 🔴4xx/5xx)
- [x] Streaming request indicator (◐)
- [x] Request/Response/Timing tabs
- [x] JSON syntax highlighting
- [x] Copy as cURL/Python/JavaScript
- [x] Replay request with modifications
- [x] Diff two responses
- [x] Session save/load
- [x] HAR export
- [x] Command palette (⌘K)

### Terminal Logging
Configurable verbosity via `--log-level`:

**Minimal:**
```
POST /v1/chat/completions 200 1.2s grok-code-fast-1 [45 tok/s]
```

**Compact (default):**
```
→ POST https://opencode.ai/zen/v1/responses [grok-code-fast-1]
← 200 OK (1.2s, TTFB: 150ms, 45 tok/s, 120 tokens)
```

**Verbose:**
```
────────────────────────────────────────
POST /v1/chat/completions
Model: grok-code-fast-1 → opencode.ai
Status: 200 OK
Timing: 1.2s total, 150ms TTFB, 45 tok/s
Tokens: 50 prompt, 70 completion
────────────────────────────────────────
```

## Timing Metrics (LLM-specific)

```
┌─ Timing ─────────────────────────────────────────────────────────────┐
│  DNS Lookup      ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  12ms     │
│  TCP Connect     ░░░░████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  15ms     │
│  TLS Handshake   ░░░░░░░░████████░░░░░░░░░░░░░░░░░░░░░░░░  45ms     │
│  Request Sent    ░░░░░░░░░░░░░░░░█░░░░░░░░░░░░░░░░░░░░░░░  2ms      │
│  Waiting (TTFB)  ░░░░░░░░░░░░░░░░░████████████████████░░░  890ms    │
│  Content Download░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░████  156ms    │
│  ─────────────────────────────────────────────────────────────────── │
│  Total: 1,120ms                                                      │
│  Stream Chunks: 47 | First Token: 234ms | Tokens/sec: 52.3          │
└──────────────────────────────────────────────────────────────────────┘
```

## File Locations

| Purpose | Path |
|---------|------|
| Config | `~/.config/freetier/config.toml` |
| Logs | `~/.local/share/freetier/logs/` |
| Sessions | `~/.local/share/freetier/sessions/` |
| Launch Agent | `~/Library/LaunchAgents/com.freetier.app.plist` |

## Accessibility

- Full keyboard navigation (arrow keys, Enter, Escape)
- VoiceOver support with ARIA labels
- 4.5:1 contrast ratio minimum
- Respects prefers-reduced-motion
- Respects prefers-color-scheme

## Homebrew Distribution

```ruby
class Freetier < Formula
  desc "Local API gateway for free LLMs with traffic inspector"
  homepage "https://github.com/username/freetier"
  version "0.1.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/.../freetier-0.1.0-aarch64-apple-darwin.tar.gz"
    else
      url "https://github.com/.../freetier-0.1.0-x86_64-apple-darwin.tar.gz"
    end
  end

  def install
    bin.install "freetier"
    prefix.install "FreeTier.app"
  end

  service do
    run [opt_bin/"freetier", "serve"]
    keep_alive true
  end
end
```

## Implementation Phases

### Phase 1: Core Completion
- Add `src/main.rs` with clap CLI
- Implement config.rs (TOML loading)
- Add terminal logging with verbosity levels
- Integrate inspector into API handlers

### Phase 2: Tauri Setup
- Initialize Tauri project structure
- Configure menu bar / system tray
- Implement IPC between Rust and frontend

### Phase 3: Frontend UI
- SolidJS + Tailwind setup
- Request list with virtual scrolling
- Detail panel with tabs
- Settings dialog

### Phase 4: Advanced Features
- Copy as cURL/Python/JS
- Replay request
- Diff view
- Session save/load
- Command palette

### Phase 5: Distribution
- GitHub Actions for cross-compilation
- Code signing for macOS
- Homebrew formula
- Auto-update mechanism
