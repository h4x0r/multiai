# Streaming Architecture Refactor + Multi-Platform

**Date:** 2026-01-03
**Status:** Approved
**Priority:** Debuggability (production debugging)

## Overview

Radical refactoring of streaming architecture for long-term maintainability, debuggability, and extendability. Adds Chrome extension and Windows MSI builds with shared codebase.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         App.jsx                                  │
│                    (UI orchestration only)                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    useStreamingChat()                            │
│            (Solid.js hook - reactive state bridge)               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    StreamingClient                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │  Abort   │  │  Retry   │  │ Circuit  │  │    Telemetry     │ │
│  │Controller│  │  Policy  │  │ Breaker  │  │     Logger       │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    streamingApi.js                               │
│              (Low-level fetch + SSE parsing)                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Backend (Rust/Proxy)                          │
│         /v1/chat/completions    /api/telemetry (Vercel)         │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### StreamingClient

Main orchestrator with abort, retry, and circuit breaker support.

```javascript
class StreamingClient {
  constructor(options = {}) {
    this.retryPolicy = new RetryPolicy(options.retry);
    this.circuitBreaker = new CircuitBreaker(options.circuit);
    this.telemetry = new TelemetryLogger(options.telemetry);
    this.activeRequests = new Map();
  }

  async stream(requestId, { model, messages, onChunk, onComplete, onError }) { ... }
  abort(requestId) { ... }
  abortAll() { ... }
}
```

### RetryPolicy

Exponential backoff with jitter.

- Max attempts: 3
- Base delay: 1000ms
- Max delay: 30000ms
- Jitter: ±30%
- Retryable: network errors, 5xx, 429

### CircuitBreaker

Per-model rate limit protection.

- Failure threshold: 5 consecutive failures
- Reset time: 60 seconds
- States: closed → open → half-open → closed

### TelemetryLogger

Batched telemetry to Vercel OTel.

- Endpoint: https://multiai-telemetry.vercel.app/api/telemetry
- Batch size: 10 events
- Flush interval: 5 seconds
- Silent failures (never interrupts user)

### Typed Errors

```javascript
StreamingError (base)
├── NetworkError (isRetryable: true)
├── RateLimitError (isRetryable: true, isRateLimited: true)
├── CircuitOpenError (isRetryable: false)
└── AbortError (isRetryable: false)
```

### useStreamingChat Hook

Solid.js reactive bridge.

```javascript
const { responses, isStreaming, streamToModels, abort } = useStreamingChat();
```

## Multi-Platform Architecture

```
multiai/
├── frontend/                    # Shared UI code (Solid.js)
│   └── src/
│       ├── services/streaming/  # Shared streaming logic
│       ├── hooks/               # Shared hooks
│       └── components/          # Shared components
├── src-tauri/                   # Desktop (macOS/Windows)
│   └── Cargo.toml
├── extension/                   # Chrome extension
│   ├── manifest.json
│   ├── popup.html
│   └── background.js
└── telemetry/                   # Vercel serverless
    └── api/telemetry/route.ts
```

### Platform Differences

| Feature | Desktop (Tauri) | Chrome Extension |
|---------|-----------------|------------------|
| Backend | Local Rust server | Direct API calls |
| Storage | SQLite | chrome.storage |
| API Keys | Local config | chrome.storage.sync |
| Distribution | DMG/MSI | Chrome Web Store |

### Shared Code Strategy

1. `frontend/src/services/streaming/` - 100% shared
2. `frontend/src/hooks/` - 100% shared
3. `frontend/src/components/` - 95% shared (minor platform checks)
4. Platform-specific adapters for storage/config

## File Structure

```
frontend/src/
├── services/
│   └── streaming/
│       ├── index.js              # Public exports
│       ├── StreamingClient.js    # Main orchestrator
│       ├── RetryPolicy.js        # Retry logic
│       ├── CircuitBreaker.js     # Circuit breaker
│       ├── TelemetryLogger.js    # Vercel OTel sender
│       ├── errors.js             # Typed errors
│       ├── streamingApi.js       # Low-level fetch
│       └── sseParser.js          # SSE parsing
├── hooks/
│   └── useStreamingChat.js       # Solid.js reactive bridge
└── stores/
    └── comparisonStore.js        # DELETE (replaced by hook)
```

## Implementation Plan

1. StreamingClient + tests
2. RetryPolicy + tests
3. CircuitBreaker + tests
4. TelemetryLogger + tests
5. errors.js + tests
6. useStreamingChat hook + tests
7. Refactor App.jsx
8. Chrome extension setup
9. Windows MSI build
10. Vercel telemetry function
11. Integration tests across platforms

## Success Criteria

- [ ] All streaming tests pass (existing 43 + new)
- [ ] Abort actually stops in-flight requests
- [ ] Retry works for transient failures
- [ ] Circuit breaker protects against rate limits
- [ ] Telemetry visible in Vercel dashboard
- [ ] Chrome extension installable and functional
- [ ] Windows MSI builds and installs
- [ ] No regressions in macOS DMG
