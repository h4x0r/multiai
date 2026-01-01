# Implementation Plan: Core Gateway

## Summary
Complete the FreeTier gateway with remaining features: integrate traffic inspection into the API layer, add a CLI binary for standalone operation, implement streaming support, and enhance error handling with proper observability.

## Current State

### Completed Components
| Component | File | Status |
|-----------|------|--------|
| FreeModelScanner | `src/scanner.rs` | Complete - discovers free models from OpenRouter & models.dev |
| TrafficInspector | `src/inspector.rs` | Complete - captures transactions with timing metrics |
| OpenAI API | `src/api.rs` | Partial - endpoints work, inspector not integrated |

### Missing Components
- CLI binary (`src/main.rs`)
- Inspector integration in API handlers
- Streaming response support
- Configuration management
- Graceful shutdown

## Architecture

### Component Diagram
```
┌─────────────────────────────────────────────────────────────┐
│                         CLI (main.rs)                        │
│  - Config loading                                            │
│  - Server startup                                            │
│  - Graceful shutdown                                         │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                      API Layer (api.rs)                      │
│  - /health                                                   │
│  - /v1/models                                                │
│  - /v1/chat/completions                                      │
│  - /v1/inspect (traffic export)                              │
└──────────┬───────────────────────────────────┬──────────────┘
           │                                   │
┌──────────▼──────────┐           ┌───────────▼─────────────┐
│  FreeModelScanner   │           │    TrafficInspector     │
│  - OpenRouter scan  │           │    - Request capture    │
│  - models.dev scan  │           │    - Response capture   │
│  - Caching          │           │    - HAR export         │
└──────────┬──────────┘           └─────────────────────────┘
           │
┌──────────▼──────────┐
│   Upstream APIs     │
│  - OpenRouter       │
│  - models.dev       │
└─────────────────────┘
```

### Data Flow
1. Request → API handler → Validate model is free
2. Create transaction in inspector (if enabled)
3. Forward to upstream provider with appropriate API key
4. Capture response and timing
5. Complete transaction, return response

## Implementation Phases

### Phase 1: CLI & Configuration
- [ ] Create `src/main.rs` with Axum server setup
- [ ] Add environment-based configuration (host, port, cache TTL)
- [ ] Implement graceful shutdown with Ctrl+C handler
- [ ] Add startup logging with config summary

### Phase 2: Inspector Integration
- [ ] Add `TrafficInspector` to `AppState`
- [ ] Wrap chat_completions handler with transaction capture
- [ ] Add `GET /v1/inspect` endpoint for HAR export
- [ ] Add `DELETE /v1/inspect` endpoint to clear history

### Phase 3: Streaming Support
- [ ] Detect `stream: true` in chat requests
- [ ] Implement SSE response forwarding
- [ ] Track TTFB for streaming responses
- [ ] Aggregate tokens from streaming chunks

### Phase 4: Enhanced Error Handling
- [ ] Add provider health checks before routing
- [ ] Implement retry logic with exponential backoff
- [ ] Add circuit breaker for failing providers
- [ ] Structured error responses with request IDs

### Phase 5: Observability
- [ ] Add tracing spans for request lifecycle
- [ ] Emit metrics (request count, latency histogram)
- [ ] Add request correlation ID header (`X-Request-ID`)
- [ ] Structured JSON logs with context

## Dependencies
- All Cargo.toml dependencies already declared
- External: OpenRouter API, models.dev API
- Environment: `OPENROUTER_API_KEY`, `OPENCODE_ZEN_API_KEY`

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Upstream API changes | Model discovery breaks | Version lock APIs, add schema validation |
| Rate limiting by providers | Requests fail | Add local rate limiting, caching |
| Memory growth from inspector | OOM on long runs | Add max transaction limit, LRU eviction |
| Streaming complexity | Partial responses | Comprehensive testing with mock servers |

## Testing Strategy

### Unit Tests
- Scanner: Mock HTTP responses, verify free model filtering
- Inspector: Transaction lifecycle, timing accuracy, HAR format
- API: Request validation, error responses

### Integration Tests
- End-to-end request flow with mock upstream
- Streaming response handling
- Cache behavior (TTL, force-refresh)

### Manual Testing
- Real API calls to OpenRouter/models.dev
- HAR import into Chrome DevTools
- Load testing with `wrk` or `hey`

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `src/main.rs` | Create | CLI binary entry point |
| `src/api.rs` | Modify | Add inspector integration, new endpoints |
| `src/lib.rs` | Modify | Export config module if added |
| `src/config.rs` | Create | Configuration management (optional) |
