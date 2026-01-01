# Feature: Core Gateway

## Overview
FreeTier is a high-performance local API gateway that provides unified access to free-tier LLM providers through an OpenAI-compatible API. It automatically discovers free models from OpenRouter and models.dev, routes requests to the appropriate provider, and provides Wireshark-style traffic inspection for debugging and performance analysis.

## Goals
- Provide an OpenAI-compatible API endpoint for seamless integration with existing tools
- Automatically discover and aggregate free LLM models from multiple sources
- Enable intelligent routing to available free models
- Capture detailed request/response metrics for debugging and optimization
- Minimize latency through efficient caching and async operations

## Non-Goals
- User authentication (delegated to upstream/client responsibility)
- Billing or usage tracking beyond basic metrics
- Model hosting or fine-tuning
- Paid model support (by design, free-tier only)

## Requirements

### Functional Requirements

#### FR1: OpenAI-Compatible API
1. `GET /health` - Health check endpoint returning JSON status
2. `GET /v1/models` - List all discovered free models in OpenAI format
3. `POST /v1/chat/completions` - Forward chat completion requests to appropriate provider

#### FR2: Free Model Discovery
1. Scan OpenRouter API for models with `pricing.prompt=0` and `pricing.completion=0`
2. Scan models.dev API for models with `cost.input=0` and `cost.output=0`
3. Cache discovered models with configurable TTL (default: 5 minutes)
4. Support force-refresh to bypass cache

#### FR3: Request Routing
1. Support `model: "auto"` to automatically select the first available free model
2. Support explicit model selection by ID
3. Validate that requested model is free before routing
4. Forward requests with proper API key based on source (OpenRouter vs models.dev)

#### FR4: Traffic Inspection
1. Capture full request/response payloads in JSON format
2. Track timing metrics: total duration, time-to-first-byte (TTFB)
3. Track LLM-specific metrics: prompt tokens, completion tokens, tokens/second
4. Export captured data in HAR (HTTP Archive) format
5. Toggle inspection on/off for performance

### Non-Functional Requirements

#### NFR1: Performance
1. Response latency overhead < 5ms (excluding upstream time)
2. Support 1000+ concurrent connections
3. Efficient memory usage through Arc and zero-copy where possible

#### NFR2: Reliability
1. Graceful degradation when upstream sources fail
2. Return clear error messages with appropriate HTTP status codes
3. Handle timeout scenarios (30s default for upstream requests)

#### NFR3: Observability
1. Structured JSON logging via tracing
2. Request correlation IDs via UUID
3. HAR export for external analysis tools

## Design Considerations

### Architecture
- **Layered design**: Handlers → Services → External APIs
- **State sharing**: `AppState` via `Arc<T>` for thread-safe sharing
- **Async-first**: All I/O operations are async via Tokio

### Data Sources
| Source | API Endpoint | Free Detection |
|--------|--------------|----------------|
| OpenRouter | `https://openrouter.ai/api/v1/models` | `pricing.prompt=0 && pricing.completion=0` |
| OpenCode Zen | `https://opencode.ai/zen/v1/responses` | Hardcoded list of beta free models |

**Note:** models.dev is a directory/catalog only, NOT an API provider. Do not route through it.

### OpenCode Zen Free Models (Beta)
These models are currently free during their beta period:
- `grok-code-fast-1`
- `glm-4.7`
- `minimax-m2.1`
- `big-pickle`

### API Keys
- `OPENROUTER_API_KEY` - For OpenRouter requests
- `OPENCODE_ZEN_API_KEY` - For OpenCode Zen requests

## Open Questions
- Should we add rate limiting per provider to avoid abuse?
- Should streaming responses be supported in traffic capture?
- Should we add provider health checks before routing?

## Success Criteria
- [ ] All existing tests pass (`cargo test`)
- [ ] API responds within 5ms overhead (excluding upstream)
- [ ] Free models correctly identified from both sources
- [ ] Traffic inspector captures complete request/response cycles
- [ ] HAR export is valid and importable by browser dev tools
