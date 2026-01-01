# Project Constitution: freetier

## Project Identity
**Name**: freetier
**Purpose**: High-performance local API gateway for routing requests to free LLM providers
**License**: MIT

## Core Principles

### 1. Performance First
- Optimize for low latency and high throughput
- Use async/await patterns throughout
- Leverage Rust's zero-cost abstractions

### 2. Simplicity
- Keep the API surface minimal
- Avoid over-engineering
- Prefer explicit over implicit behavior

### 3. Reliability
- Graceful degradation when providers fail
- Proper error handling and reporting
- Comprehensive logging for debugging

### 4. Developer Experience
- Easy to configure and deploy
- Clear documentation
- Sensible defaults

## Technical Standards

### Language & Framework
- **Language**: Rust (2021 edition)
- **Web Framework**: Axum
- **Async Runtime**: Tokio

### Code Quality
- All public APIs must be documented
- Tests required for new functionality
- No unsafe code without justification

### Architecture Patterns
- Layered architecture (handlers → services → providers)
- Dependency injection for testability
- Configuration via environment variables

## Scope Boundaries

### In Scope
- OpenAI-compatible API proxy
- Request routing to multiple LLM providers
- Response caching
- Rate limiting
- Health checks

### Out of Scope
- User authentication (delegated to upstream)
- Billing/usage tracking
- Model fine-tuning
- Direct model hosting
