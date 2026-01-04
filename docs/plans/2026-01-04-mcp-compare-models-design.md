# MCP Server: Model Comparison Tool

**Date:** 2026-01-04
**Status:** Implemented

## Overview

Add an MCP (Model Context Protocol) server to MultiAI that exposes a `compare_models` tool. This allows Claude Desktop, Cursor, and other MCP-compatible clients to request side-by-side model comparisons with comprehensive scoring.

## Tool Specification

### `compare_models`

```typescript
compare_models(
  prompt: string,              // The prompt to test
  models?: string[],           // Optional: specific models, default = all free
  max_models?: number,         // Optional: limit to N models
  include_ranking?: boolean,   // Optional: run LLM judges, default = true
  weights?: {                  // Optional: custom scoring weights
    speed: number,
    quality: number,
    efficiency: number
  }
)
```

## Response Format

### Structured JSON

```json
{
  "prompt": "Explain quantum entanglement simply",
  "compared_at": "2026-01-04T12:00:00Z",
  "results": [
    {
      "model": "llama-3.3-70b",
      "source": "openrouter",
      "response": "Quantum entanglement is...",
      "metrics": {
        "ttft_ms": 245,
        "total_ms": 1820,
        "input_tokens": 24,
        "output_tokens": 156,
        "tokens_per_sec": 85.7,
        "cost": {
          "input_cost": 0.0,
          "output_cost": 0.0,
          "total_cost": 0.0,
          "paid_equivalent": 0.0234
        }
      },
      "scores": {
        "speed": 8.5,
        "quality": 7.2,
        "efficiency": 9.0,
        "overall": 8.2
      }
    }
  ],
  "ranking": ["llama-3.3-70b", "gemini-2.0-flash", "qwen-2.5-72b"],
  "markdown_summary": "..."
}
```

### Markdown Summary

```markdown
## Comparison Results

| Model | TTFT | Total | Quality | Cost | Overall |
|-------|------|-------|---------|------|---------|
| llama-3.3-70b | 245ms | 1.8s | 7.2 | $0.00 (~$0.02) | **8.2** |
| gemini-2.0-flash | 180ms | 2.1s | 6.8 | $0.00 (~$0.01) | **7.5** |
| qwen-2.5-72b | 320ms | 2.4s | 7.0 | $0.00 (~$0.03) | **7.1** |

**Winner:** llama-3.3-70b (best balance of speed and quality)
```

## Scoring Logic

### Speed Score (0-10)
Objective, calculated from metrics:
```
speed = 10 - (ttft_ms / 100)  // 100ms = 9, 500ms = 5, 1s+ = 0
       + bonus for tokens_per_sec > 50
```

### Quality Score (0-10)
Multi-judge consensus using 7 premium models via OpenRouter:

**Judge Panel:**
1. Claude Opus 4.5
2. GPT-5.2 Pro
3. Gemini 3 Pro Preview
4. Mistral Large 2512
5. DeepSeek R1
6. Grok 4 Fast
7. MiniMax M2

**Judge Prompt:**
```
You are evaluating AI responses. Rate this response on a scale of 1-10.

Original question: "{user_prompt}"

Response to evaluate:
"""
{model_response}
"""

Score based on:
- Accuracy: Is the information correct?
- Completeness: Does it fully answer the question?
- Clarity: Is it well-structured and easy to understand?
- Usefulness: Would this actually help the user?

Reply with ONLY a JSON object: {"score": N, "reason": "brief explanation"}
```

**Consensus:** Final score = median of 7 judge scores (robust to outliers, odd number avoids ties).

**Requirements:** OpenRouter API key required for judging. Estimated cost ~$0.05-0.15 per comparison.

### Data Residency (US/EU Only)

Force all judges through US/EU infrastructure via provider routing:

| Judge | Provider | Region |
|-------|----------|--------|
| Claude Opus 4.5 | Anthropic | US |
| GPT-5.2 Pro | OpenAI | US |
| Gemini 3 Pro Preview | Google | US |
| Grok 4 Fast | xAI | US |
| Mistral Large 2512 | Mistral | EU |
| DeepSeek R1 | Fireworks / Together | US |
| MiniMax M2 | Fireworks | US |

**API routing config:**
```json
{
  "model": "deepseek/deepseek-r1",
  "provider": {
    "order": ["Fireworks", "Together", "DeepInfra"],
    "allow_fallbacks": false
  }
}
```

```json
{
  "model": "minimax/minimax-m2",
  "provider": {
    "order": ["Fireworks"],
    "allow_fallbacks": false
  }
}
```

**Default behavior:** All judges always route through US/EU providers. No configuration needed.

### Efficiency Score (0-10)
Value per token:
```
efficiency = min(10, output_tokens / (paid_equivalent * 1000))
// More tokens for less money = higher score
```

### Overall Score
Weighted average:
```
overall = (speed * 0.25) + (quality * 0.50) + (efficiency * 0.25)
```
Quality weighted highest. Users can customize weights via tool parameter.

## Architecture

### New Rust Modules

```
src/
├── mcp/
│   ├── mod.rs          # MCP server entry point
│   ├── transport.rs    # stdio transport handling
│   ├── tools.rs        # Tool definitions (compare_models)
│   └── judge.rs        # LLM judge scoring logic
```

### MCP Server Lifecycle

1. User adds MultiAI to `claude_desktop_config.json`
2. Claude Desktop spawns `multiai --mcp` as child process
3. MultiAI reads JSON-RPC requests from stdin, writes responses to stdout
4. Existing HTTP server still runs (comparison UI, direct API access)

### Execution Flow

```
Claude: "Compare llama and gemini on this coding question"
    ↓
MCP: compare_models(prompt="...", models=["llama-3.3-70b", "gemini-2.0-flash"])
    ↓
MultiAI: Fan out requests to all specified models in parallel
    ↓
Collect responses + metrics
    ↓
Fan out to 7 judge models in parallel
    ↓
Calculate median scores, build ranking
    ↓
Return JSON + markdown to Claude
```

## Configuration

### Claude Desktop Setup

```json
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "multiai": {
      "command": "/Applications/MultiAI.app/Contents/MacOS/multiai",
      "args": ["--mcp"]
    }
  }
}
```

### MultiAI Settings

```
☑ Enable premium quality scoring
  Uses 7 top models as judges via OpenRouter
  Estimated cost: ~$0.05-0.15 per comparison
```

## Error Handling

- **Model timeout:** Exclude from results, note in response
- **All models fail:** Return error with details
- **Judge fails:** Use remaining judges (minimum 3 for valid median)
- **< 3 judges available:** Fallback to heuristic scoring with warning

### Fallback Heuristics (when judges unavailable)

- Length score: 50-500 chars = good, too short/long penalized
- Structure bonus: Has code blocks, lists, headers where appropriate
- Refusal penalty: "I cannot" / "As an AI" responses scored lower

## Testing Strategy

1. **Unit tests:** Scoring logic (speed, quality, efficiency calculations)
2. **Integration tests:** Mock MCP client, verify JSON-RPC protocol
3. **E2E tests:** Spawn MultiAI, send compare_models request, verify response format

## Spending Caps

### Defaults
- **Daily cap:** $5.00
- **Monthly cap:** $50.00
- **Warn at:** 80%

### Configuration Priority (highest to lowest)
1. CLI flags
2. Environment variables
3. Config file
4. App settings (GUI)
5. Built-in defaults

### CLI Flags
```bash
multiai serve --daily-cap 5.00 --monthly-cap 50.00 --warn-at-percent 80
multiai --mcp --daily-cap 10.00
```

### Environment Variables
```bash
export MULTIAI_DAILY_CAP=5.00
export MULTIAI_MONTHLY_CAP=50.00
export MULTIAI_WARN_AT_PERCENT=80
multiai serve
```

### Config File
`~/.config/multiai/config.toml`:
```toml
[spending]
daily_cap = 5.00
monthly_cap = 50.00
warn_at_percent = 80
```

### API Endpoint
```
GET  /api/settings/spending
POST /api/settings/spending { "daily_cap": 5.00, "monthly_cap": 50.00, "warn_at_percent": 80 }
```

### App Settings UI
```
Spending Limits
├── Daily cap: [$5.00____] USD
├── Monthly cap: [$50.00___] USD
├── Warn at: [80__]%
└── Progress: ████████░░ $4.12 / $5.00 (82%)
```

### Enforcement

**Tracking (SQLite):**
```sql
CREATE TABLE spending (
  id TEXT PRIMARY KEY,  -- 'daily' or 'monthly'
  amount REAL NOT NULL,
  reset_at TEXT NOT NULL
);
```

**Check before API call:**
```rust
fn check_spending_cap(estimated_cost: f64) -> Result<(), SpendingError> {
    let daily = get_daily_spending();
    let monthly = get_monthly_spending();
    let config = get_spending_config();

    if daily + estimated_cost > config.daily_cap {
        return Err(SpendingError::DailyCapExceeded);
    }
    if monthly + estimated_cost > config.monthly_cap {
        return Err(SpendingError::MonthlyCapExceeded);
    }
    Ok(())
}
```

**Warning threshold:**
- At 80% (configurable): Log warning, show in UI
- At 100%: Block request, return error

**Reset schedule:**
- Daily: Midnight UTC
- Monthly: 1st of month UTC

**Response when cap exceeded:**
```json
{
  "error": "spending_cap_exceeded",
  "message": "Daily spending cap of $5.00 reached ($5.12 used)",
  "cap_type": "daily",
  "used": 5.12,
  "cap": 5.00,
  "resets_at": "2026-01-05T00:00:00Z"
}
```

## Implementation Checklist

### MCP Server
- [x] Add `--mcp` CLI flag to start MCP mode
- [x] Implement stdio JSON-RPC transport
- [x] Register `compare_models` tool with MCP
- [x] Parallel model request fan-out
- [x] Parallel judge fan-out via OpenRouter
- [x] Scoring calculations (speed, quality, efficiency)
- [x] Markdown summary generation

### Spending Caps
- [x] SQLite spending table
- [x] Config file parser (`~/.config/multiai/config.toml`)
- [x] Environment variable support
- [ ] CLI flags (`--daily-cap`, `--monthly-cap`, `--warn-at-percent`)
- [ ] API endpoints (`GET/POST /api/settings/spending`)
- [ ] Settings UI with progress bar
- [ ] Pre-request spending check in router
- [x] Pre-request spending check in MCP
- [x] Daily/monthly reset logic

### Documentation
- [x] Claude Desktop setup guide (see below)
- [x] Headless configuration guide (see below)

---

## Claude Desktop Setup Guide

### Prerequisites

1. **OpenRouter API key** for premium quality scoring
2. **MultiAI binary** built and installed

### Installation

1. Build MultiAI:
```bash
cd /path/to/multiai
cargo build --release
```

2. Copy binary to Applications (macOS):
```bash
mkdir -p /Applications/MultiAI.app/Contents/MacOS
cp target/release/multiai /Applications/MultiAI.app/Contents/MacOS/
```

3. Configure Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "multiai": {
      "command": "/Applications/MultiAI.app/Contents/MacOS/multiai",
      "args": ["--mcp"]
    }
  }
}
```

4. Restart Claude Desktop.

### Usage in Claude

Ask Claude to compare models:
```
Compare llama and gemini on this coding question: "Write a function to check if a string is a palindrome"
```

Claude will use the `compare_models` tool to:
1. Query multiple free LLM models in parallel
2. Score responses for speed, quality, and efficiency
3. Return a ranked comparison with markdown summary

### Configuration

Create `~/.config/multiai/config.toml`:
```toml
[api_keys]
openrouter = "sk-or-..."  # Required for quality scoring

[spending]
daily_cap = 5.00      # USD per day
monthly_cap = 50.00   # USD per month
warn_at_percent = 80  # Warn at 80% usage
```

Or use environment variables:
```bash
export OPENROUTER_API_KEY="sk-or-..."
export MULTIAI_DAILY_CAP=5.00
export MULTIAI_MONTHLY_CAP=50.00
```

---

## Headless Configuration Guide

For running MultiAI on servers without a GUI.

### Quick Start

```bash
# Set API key
export OPENROUTER_API_KEY="sk-or-..."

# Run MCP server
multiai --mcp
```

### Systemd Service (Linux)

Create `/etc/systemd/system/multiai-mcp.service`:
```ini
[Unit]
Description=MultiAI MCP Server
After=network.target

[Service]
Type=simple
User=youruser
Environment=OPENROUTER_API_KEY=sk-or-...
Environment=MULTIAI_DAILY_CAP=10.00
ExecStart=/usr/local/bin/multiai --mcp
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable multiai-mcp
sudo systemctl start multiai-mcp
```

### Docker

```dockerfile
FROM rust:1.75 as builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=builder /app/target/release/multiai /usr/local/bin/
ENV OPENROUTER_API_KEY=""
CMD ["multiai", "--mcp"]
```

### Configuration Priority

Settings are loaded in this order (highest priority first):
1. Environment variables
2. Config file (`~/.config/multiai/config.toml`)
3. Built-in defaults

### Monitoring

Check spending status:
```bash
sqlite3 ~/.config/multiai/spending.db "SELECT * FROM spending"
```

View logs:
```bash
journalctl -u multiai-mcp -f
```
