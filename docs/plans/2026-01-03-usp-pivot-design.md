# MultiAI USP Pivot: Free LLM Proxy

**Date:** 2026-01-03
**Status:** Approved

## Executive Summary

MultiAI is repositioning from "AI comparison tool" to "OpenAI-compatible proxy for free LLMs."

## Core Product

**Product 1 (Primary):** OpenAI-compatible API server for free models

- Exposes standard OpenAI endpoints on `localhost:11434`
- Routes to free models from OpenRouter + OpenCodeZen
- BYOK (Bring Your Own Keys), zero markup
- Desktop-native (Tauri)

**Product 2 (Bonus):** Side-by-side comparison UI

- Visual tool for comparing model responses
- Discovery/demo interface, not core value

## Unique Selling Proposition

> "Drop-in OpenAI proxy that only routes to free models. Point Cursor, Continue, or any AI tool at `localhost:11434` and use free LLMs instantly."

## Competitive Analysis

| Feature | LiteLLM | OpenRouter | **MultiAI** |
|---------|---------|------------|-------------|
| OpenAI-compatible | Yes | Yes | Yes |
| Free model focus | No | No (has free tier) | **Yes - Only free** |
| Zero config | No (complex setup) | Yes (web) | **Yes - Desktop app** |
| Zero markup | Yes | No (adds fee) | **Yes** |
| Comparison UI | No | No | **Yes (bonus)** |

## Architecture

```
External Tools (Cursor, Continue, etc.)
           ↓
    localhost:11434
           ↓
    ┌─────────────────────────────┐
    │      MultiAI Backend        │
    │  (Rust/Axum on port 11434)  │
    │                             │
    │  GET /v1/models             │  ← Standard OpenAI
    │  POST /v1/chat/completions  │  ← Standard OpenAI
    │  GET /v1/models/grouped     │  ← Our extension (for UI)
    └─────────────────────────────┘
           ↓
    FreeModelScanner (caches free models)
           ↓
    ┌─────────────┬───────────────┐
    │ OpenCodeZen │  OpenRouter   │
    │ (preferred) │  (fallback)   │
    └─────────────┴───────────────┘
```

## What We Are

1. **OpenAI-compatible proxy** - Standard API on port 11434
2. **Free model aggregator** - Scans providers for free tiers
3. **BYOK with zero markup** - User's keys, no middleman fees
4. **Desktop-native** - Tauri app, no server setup

## What We Are NOT

1. **Privacy-first** - Data goes through cloud providers
2. **Local model runner** - Despite port 11434, we don't run models
3. **Smart router** - No cost/latency optimization (yet)
4. **Subscription service** - No recurring fees to us

## Target Users

1. **Developers** - Point coding tools at free models
2. **Cost-conscious users** - Use LLMs without paying
3. **Model explorers** - Compare outputs before committing to a provider

## Implementation Status

- [x] Rust backend with OpenAI-compatible endpoints
- [x] FreeModelScanner for OpenRouter + OpenCodeZen
- [x] Streaming SSE support
- [x] Side-by-side comparison UI
- [x] Resilience layer (retry, circuit breaker)
- [x] Frontend streaming hook (`useStreamingChat`)
- [x] MCP server for Claude Desktop integration
- [x] Desktop app (Tauri DMG for macOS)
- [x] Document upload (PDF, DOCX, TXT)
- [x] Chat export (PDF, DOCX, Markdown)
- [x] LLM-as-judge quality scoring

## Removed from Scope

- Chrome browser extension (user said not needed)
- Windows MSI build (deferred)
- Vercel telemetry (self-contained, not needed)
- Privacy claims (we use cloud providers)
- Offline/local model support (not implemented)
