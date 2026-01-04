# MultiAI

Compare multiple free AI models side by side. Send one question, get answers from different models simultaneously.

## Features

- **Side-by-side comparison** - Compare responses from multiple LLMs in real-time
- **Free model discovery** - Automatically discovers free models from OpenRouter and OpenCode Zen
- **Local Ollama support** - Prioritizes local models when available
- **OpenAI-compatible API** - Drop-in replacement for existing tools
- **MCP server** - Use with Claude Desktop via Model Context Protocol
- **Desktop app** - Native macOS app with Tauri (DMG distribution)
- **Document upload** - PDF, DOCX, and TXT file support
- **Chat export** - Export conversations to PDF, DOCX, or Markdown

## Installation

### Desktop App (macOS)

Download the latest DMG from [Releases](../../releases) or build from source:

```bash
cd frontend && npm install && npm run build
cargo tauri build
open src-tauri/target/release/bundle/dmg/MultiAI_*.dmg
```

### CLI

```bash
cargo install --path .
```

## Usage

### Desktop App

```bash
cargo tauri dev    # Development mode
cargo tauri build  # Build DMG
```

### CLI Server

```bash
# Start with defaults (port 11434)
multiai

# Custom port
multiai serve --port 8080

# Show config
multiai config
multiai config --path
```

### MCP Mode (Claude Desktop)

Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "multiai": {
      "command": "/path/to/multiai",
      "args": ["--mcp"]
    }
  }
}
```

Then use in Claude: "Compare what GPT and Claude think about X"

### API

OpenAI-compatible endpoints:

```bash
# List available models
curl http://localhost:11434/v1/models

# Chat completion
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "auto", "messages": [{"role": "user", "content": "Hello"}]}'

# Health check
curl http://localhost:11434/health
```

## Configuration

Config file: `~/.config/multiai/config.toml`

```toml
[gateway]
port = 11434

[openrouter]
api_key = "sk-or-..."  # Optional, for paid models

[opencode_zen]
api_key = "..."  # Optional
```

Environment variables override config:
- `OPENROUTER_API_KEY`
- `OPENCODE_ZEN_API_KEY`
- `MULTIAI_PORT`

## Architecture

```
src/
├── api/           # OpenAI-compatible REST API
│   ├── handlers   # Request handlers
│   └── types      # API types
├── chat_api/      # Web UI chat endpoints
│   ├── handlers   # CRUD handlers
│   ├── types      # Request/response types
│   └── tests      # Integration tests
├── mcp/           # MCP server for Claude Desktop
│   ├── compare    # Model comparison logic
│   ├── judge      # LLM-as-judge ranking
│   └── spending   # Cost tracking
├── scanner/       # Free model discovery
│   └── tests      # Scanner tests
├── chat.rs        # SQLite chat storage
├── config.rs      # TOML configuration
├── document.rs    # PDF/DOCX text extraction
├── export.rs      # Chat export (PDF/DOCX/MD)
├── inspector.rs   # Traffic inspection (HAR export)
└── logger.rs      # Structured logging

frontend/          # React + Vite UI
├── src/
│   ├── components/  # React components
│   ├── hooks/       # Custom hooks
│   ├── services/    # API clients
│   └── stores/      # Zustand stores

src-tauri/         # Tauri desktop wrapper
```

## Development

```bash
# Run tests
cargo test

# Run with logging
RUST_LOG=debug cargo run

# Frontend dev
cd frontend && npm run dev

# Build release
cargo build --release
```

## Model Sources

| Source | Priority | Description |
|--------|----------|-------------|
| Ollama | 1 (highest) | Local models at `localhost:11434` |
| OpenCode Zen | 2 | Cloud API with free tier |
| OpenRouter | 3 | Aggregator with 20+ free models |

## License

MIT
