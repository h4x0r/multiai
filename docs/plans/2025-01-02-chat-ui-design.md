# FreeTier Chat UI Design

**Date:** 2025-01-02
**Status:** Completed (renamed to MultiAI)
**Target:** $2 Mac App Store app + Web UI served by gateway

## Overview

A full-featured chat interface for end users to access free LLMs through the FreeTier gateway. Features document upload (PDF, DOCX, PPTX, XLSX, images), native macOS styling, and artifact export.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    FreeTier Gateway                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  LLM Router  │  │  Chat API    │  │ Static Files │       │
│  │  /v1/*       │  │  /api/*      │  │  /app/*      │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│         │                 │                  │               │
│         └─────────────────┼──────────────────┘               │
│                           │                                  │
│                    ┌──────┴──────┐                          │
│                    │   SQLite    │                          │
│                    │  chats.db   │                          │
│                    └─────────────┘                          │
└─────────────────────────────────────────────────────────────┘
         ↑
         │ HTTP
         ↓
┌─────────────────────────────────────────────────────────────┐
│              SolidJS Frontend (7KB bundle)                   │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ Sidebar  │  │  Chat View   │  │  Input Area  │           │
│  │ (Chats)  │  │  (Messages)  │  │  (Composer)  │           │
│  └──────────┘  └──────────────┘  └──────────────┘           │
└─────────────────────────────────────────────────────────────┘
```

## UI Layout

### Three-Column Layout
```
┌─────────────────────────────────────────────────────────────┐
│ FreeTier                                    [Settings] [?]  │
├────────────┬────────────────────────────────────────────────┤
│            │                                                │
│  Sidebar   │              Chat Area                         │
│  240px     │              (flex-1)                          │
│            │                                                │
│ ┌────────┐ │  ┌──────────────────────────────────────────┐ │
│ │+ New   │ │  │                                          │ │
│ └────────┘ │  │  Welcome! How can I help you today?      │ │
│            │  │                                    ←     │ │
│ Today      │  │                                          │ │
│ ├─ Chat 1  │  │  ┌────────────────────────────────────┐  │ │
│ └─ Chat 2  │  │  │ Hi, explain quantum computing      │→ │ │
│            │  │  └────────────────────────────────────┘  │ │
│ Yesterday  │  │                                          │ │
│ └─ Chat 3  │  │  Quantum computing uses qubits...   ←   │ │
│            │  │  ●●● (streaming)                         │ │
│            │  │                                          │ │
│            │  └──────────────────────────────────────────┘ │
│            │                                                │
│            │  ┌──────────────────────────────────────────┐ │
│            │  │ [+] Message... (⌘↩ send)    [↑] [Send]  │ │
│            │  └──────────────────────────────────────────┘ │
└────────────┴────────────────────────────────────────────────┘
```

### Design Principles
- **Native macOS Feel:** SF Pro font, system colors, vibrancy effects
- **Dark Mode:** Full support via `prefers-color-scheme`
- **Right-aligned user messages:** Visual distinction from assistant
- **SF Symbols:** Native icons throughout (`plus`, `paperclip`, `arrow.up.circle.fill`)
- **Hover-only actions:** Copy, regenerate, delete appear on hover
- **Keyboard-first:** ⌘↩ send, ⌘N new chat, ⌘K search

### Message Components
```
User Message (right-aligned):
┌────────────────────────────────────────┐
│ Explain quantum computing to me        │ ← bg-blue-500
└────────────────────────────────────────┘
                              [Copy] [Delete] ← hover only

Assistant Message (left-aligned):
┌────────────────────────────────────────┐
│ Quantum computing is a type of...      │ ← bg-gray-100
│                                        │
│ **Key concepts:**                      │
│ - Qubits can be 0 and 1 simultaneously │
│ - Entanglement links qubits            │
└────────────────────────────────────────┘
[Copy] [Regenerate]                        ← hover only
```

### Input Area
```
┌─────────────────────────────────────────────────────────────┐
│ [doc.pdf ✕] [image.png ✕]              ← attachment chips   │
├─────────────────────────────────────────────────────────────┤
│ │                                                           │
│ │ Type your message...                                      │
│ │                                                           │
├─────────────────────────────────────────────────────────────┤
│ [📎]                                    [⌘↩ to send] [↑]   │
└─────────────────────────────────────────────────────────────┘
```

### Streaming State
```
┌────────────────────────────────────────┐
│ Quantum computing is a type of         │
│ computation that uses quantum-         │
│ mechanical phenomena...█               │ ← cursor blink
└────────────────────────────────────────┘
                              [■ Stop]    ← replaces actions
```

## API Endpoints

### Chat Management
```
GET    /api/chats              - List all chats
POST   /api/chats              - Create new chat
GET    /api/chats/:id          - Get chat with messages
DELETE /api/chats/:id          - Delete chat
PATCH  /api/chats/:id          - Update title
```

### Messages
```
POST   /api/chats/:id/messages - Send message (SSE response)
DELETE /api/chats/:id/messages/:mid - Delete message
```

### File Processing
```
POST   /api/process            - Extract text from document
                                 Supports: PDF, DOCX, PPTX, XLSX, TXT, images
```

### Export
```
POST   /api/export/pdf         - Export chat as PDF
POST   /api/export/docx        - Export chat as DOCX
```

## Data Models

### Rust Types
```rust
#[derive(Serialize, Deserialize)]
pub struct Chat {
    pub id: String,
    pub title: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub chat_id: String,
    pub role: MessageRole,
    pub content: String,
    pub attachments: Vec<Attachment>,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize)]
pub enum MessageRole {
    User,
    Assistant,
}

#[derive(Serialize, Deserialize)]
pub struct Attachment {
    pub id: String,
    pub filename: String,
    pub mime_type: String,
    pub extracted_text: Option<String>,
    pub size_bytes: u64,
}
```

### TypeScript Types (Frontend)
```typescript
interface Chat {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface Message {
  id: string;
  chat_id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
  created_at: string;
}

interface Attachment {
  id: string;
  filename: string;
  mime_type: string;
  extracted_text?: string;
  size_bytes: number;
}
```

## Database Schema

```sql
-- SQLite database at ~/.local/share/freetier/chats.db

CREATE TABLE chats (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    extracted_text TEXT,
    size_bytes INTEGER NOT NULL,
    blob_path TEXT
);

CREATE INDEX idx_messages_chat ON messages(chat_id);
CREATE INDEX idx_attachments_message ON attachments(message_id);
```

## File Storage

- **Small files (<1MB):** Base64 in SQLite
- **Large files:** `~/.local/share/freetier/attachments/{uuid}`
- **Extracted text:** Always in SQLite for searchability

## Document Processing

Using **docling** (IBM Research) for document extraction:

```python
# Python sidecar process
from docling.document_converter import DocumentConverter

converter = DocumentConverter()
result = converter.convert("document.pdf")
text = result.document.export_to_markdown()
```

Supported formats:
- PDF (native + OCR fallback)
- DOCX, PPTX, XLSX
- Images (PNG, JPG, GIF, WebP)
- Plain text

## Export

### PDF Export
Using `printpdf` crate:
- Chat title as header
- Messages with role labels
- Timestamps
- Attachment filenames (not content)

### DOCX Export
Using `docx-rs` crate:
- Similar structure to PDF
- Proper heading styles
- Monospace for code blocks

## Technology Stack

| Layer | Technology |
|-------|------------|
| Backend | Rust + Axum |
| Database | SQLite (rusqlite) |
| Frontend | SolidJS + Tailwind |
| Document Processing | docling (Python sidecar) |
| PDF Export | printpdf |
| DOCX Export | docx-rs |

## Implementation Phases

1. **Chat API** - CRUD endpoints with SQLite
2. **Static file serving** - `/app/*` routes
3. **SolidJS frontend** - Basic chat UI
4. **SSE streaming** - Real-time responses
5. **File upload** - Multipart handling
6. **Docling integration** - Python sidecar
7. **Export functionality** - PDF/DOCX generation
8. **Mac App Store wrapper** - Swift WebView

## Success Criteria

- [ ] Create, list, delete chats
- [ ] Send messages and receive streamed responses
- [ ] Upload PDF/DOCX/images and extract text
- [ ] Export conversations as PDF/DOCX
- [ ] Native macOS look and feel
- [ ] Dark mode support
- [ ] Keyboard navigation
- [ ] < 100ms UI response time
- [ ] < 10MB total app size
