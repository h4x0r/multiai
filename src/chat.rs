//! Chat storage and management.
//!
//! Provides SQLite-backed storage for chat conversations with:
//! - Chat CRUD operations
//! - Message management
//! - Attachment handling

use chrono::{DateTime, Utc};
use rusqlite::{Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// A chat conversation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Chat {
    pub id: String,
    pub title: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// A message in a chat.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Message {
    pub id: String,
    pub chat_id: String,
    pub role: MessageRole,
    pub content: String,
    pub created_at: DateTime<Utc>,
}

/// Message role.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Assistant,
}

impl std::fmt::Display for MessageRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MessageRole::User => write!(f, "user"),
            MessageRole::Assistant => write!(f, "assistant"),
        }
    }
}

impl std::str::FromStr for MessageRole {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "user" => Ok(MessageRole::User),
            "assistant" => Ok(MessageRole::Assistant),
            _ => Err(format!("Invalid role: {}", s)),
        }
    }
}

/// An attachment on a message.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Attachment {
    pub id: String,
    pub message_id: String,
    pub filename: String,
    pub mime_type: String,
    pub extracted_text: Option<String>,
    pub size_bytes: u64,
}

/// Chat database operations.
pub struct ChatDb {
    conn: Connection,
}

impl ChatDb {
    /// Open or create a chat database.
    pub fn open<P: AsRef<Path>>(path: P) -> SqlResult<Self> {
        let conn = Connection::open(path)?;
        let db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    /// Create an in-memory database (for testing).
    pub fn in_memory() -> SqlResult<Self> {
        let conn = Connection::open_in_memory()?;
        let db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> SqlResult<()> {
        self.conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS chats (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS attachments (
                id TEXT PRIMARY KEY,
                message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
                filename TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                extracted_text TEXT,
                size_bytes INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
            CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);

            PRAGMA foreign_keys = ON;
            "#,
        )
    }

    /// Create a new chat.
    pub fn create_chat(&self, id: &str, title: &str) -> SqlResult<Chat> {
        let now = Utc::now();
        let now_str = now.to_rfc3339();

        self.conn.execute(
            "INSERT INTO chats (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            [id, title, &now_str, &now_str],
        )?;

        Ok(Chat {
            id: id.to_string(),
            title: title.to_string(),
            created_at: now,
            updated_at: now,
        })
    }

    /// List all chats, ordered by updated_at descending.
    pub fn list_chats(&self) -> SqlResult<Vec<Chat>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, created_at, updated_at FROM chats ORDER BY updated_at DESC",
        )?;

        let chats = stmt.query_map([], |row| {
            let created_str: String = row.get(2)?;
            let updated_str: String = row.get(3)?;

            Ok(Chat {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: DateTime::parse_from_rfc3339(&created_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                updated_at: DateTime::parse_from_rfc3339(&updated_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
            })
        })?;

        chats.collect()
    }

    /// Get a chat by ID.
    pub fn get_chat(&self, id: &str) -> SqlResult<Option<Chat>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, title, created_at, updated_at FROM chats WHERE id = ?1")?;

        let mut rows = stmt.query([id])?;

        if let Some(row) = rows.next()? {
            let created_str: String = row.get(2)?;
            let updated_str: String = row.get(3)?;

            Ok(Some(Chat {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: DateTime::parse_from_rfc3339(&created_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                updated_at: DateTime::parse_from_rfc3339(&updated_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
            }))
        } else {
            Ok(None)
        }
    }

    /// Delete a chat and all its messages.
    pub fn delete_chat(&self, id: &str) -> SqlResult<bool> {
        // Delete messages first (foreign key constraint)
        self.conn
            .execute("DELETE FROM messages WHERE chat_id = ?1", [id])?;

        let rows = self.conn.execute("DELETE FROM chats WHERE id = ?1", [id])?;
        Ok(rows > 0)
    }

    /// Update a chat's title.
    pub fn update_chat_title(&self, id: &str, title: &str) -> SqlResult<bool> {
        let now = Utc::now().to_rfc3339();
        let rows = self.conn.execute(
            "UPDATE chats SET title = ?1, updated_at = ?2 WHERE id = ?3",
            [title, &now, id],
        )?;
        Ok(rows > 0)
    }

    /// Add a message to a chat.
    pub fn add_message(
        &self,
        id: &str,
        chat_id: &str,
        role: MessageRole,
        content: &str,
    ) -> SqlResult<Message> {
        let now = Utc::now();
        let now_str = now.to_rfc3339();

        self.conn.execute(
            "INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            [id, chat_id, &role.to_string(), content, &now_str],
        )?;

        // Update chat's updated_at
        self.conn.execute(
            "UPDATE chats SET updated_at = ?1 WHERE id = ?2",
            [&now_str, chat_id],
        )?;

        Ok(Message {
            id: id.to_string(),
            chat_id: chat_id.to_string(),
            role,
            content: content.to_string(),
            created_at: now,
        })
    }

    /// Get all messages for a chat.
    pub fn get_messages(&self, chat_id: &str) -> SqlResult<Vec<Message>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, chat_id, role, content, created_at FROM messages WHERE chat_id = ?1 ORDER BY created_at ASC",
        )?;

        let messages = stmt.query_map([chat_id], |row| {
            let role_str: String = row.get(2)?;
            let created_str: String = row.get(4)?;

            Ok(Message {
                id: row.get(0)?,
                chat_id: row.get(1)?,
                role: role_str.parse().unwrap_or(MessageRole::User),
                content: row.get(3)?,
                created_at: DateTime::parse_from_rfc3339(&created_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
            })
        })?;

        messages.collect()
    }

    /// Delete a message.
    pub fn delete_message(&self, id: &str) -> SqlResult<bool> {
        let rows = self.conn.execute("DELETE FROM messages WHERE id = ?1", [id])?;
        Ok(rows > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // =========================================================================
    // RED: Tests written first - these should FAIL initially
    // =========================================================================

    #[test]
    fn creates_empty_database() {
        let db = ChatDb::in_memory().unwrap();
        let chats = db.list_chats().unwrap();
        assert!(chats.is_empty());
    }

    #[test]
    fn creates_and_retrieves_chat() {
        let db = ChatDb::in_memory().unwrap();

        let chat = db.create_chat("chat-1", "Test Chat").unwrap();

        assert_eq!(chat.id, "chat-1");
        assert_eq!(chat.title, "Test Chat");

        let retrieved = db.get_chat("chat-1").unwrap().unwrap();
        assert_eq!(retrieved.id, "chat-1");
        assert_eq!(retrieved.title, "Test Chat");
    }

    #[test]
    fn lists_chats_in_updated_order() {
        let db = ChatDb::in_memory().unwrap();

        db.create_chat("chat-1", "First").unwrap();
        db.create_chat("chat-2", "Second").unwrap();

        // Update first chat to make it more recent
        db.update_chat_title("chat-1", "First Updated").unwrap();

        let chats = db.list_chats().unwrap();
        assert_eq!(chats.len(), 2);
        assert_eq!(chats[0].id, "chat-1"); // Most recently updated
        assert_eq!(chats[1].id, "chat-2");
    }

    #[test]
    fn deletes_chat() {
        let db = ChatDb::in_memory().unwrap();

        db.create_chat("chat-1", "Test").unwrap();
        assert!(db.get_chat("chat-1").unwrap().is_some());

        let deleted = db.delete_chat("chat-1").unwrap();
        assert!(deleted);

        assert!(db.get_chat("chat-1").unwrap().is_none());
    }

    #[test]
    fn returns_false_when_deleting_nonexistent_chat() {
        let db = ChatDb::in_memory().unwrap();
        let deleted = db.delete_chat("nonexistent").unwrap();
        assert!(!deleted);
    }

    #[test]
    fn updates_chat_title() {
        let db = ChatDb::in_memory().unwrap();

        db.create_chat("chat-1", "Original").unwrap();
        db.update_chat_title("chat-1", "Updated").unwrap();

        let chat = db.get_chat("chat-1").unwrap().unwrap();
        assert_eq!(chat.title, "Updated");
    }

    #[test]
    fn adds_and_retrieves_messages() {
        let db = ChatDb::in_memory().unwrap();

        db.create_chat("chat-1", "Test").unwrap();

        db.add_message("msg-1", "chat-1", MessageRole::User, "Hello")
            .unwrap();
        db.add_message("msg-2", "chat-1", MessageRole::Assistant, "Hi there!")
            .unwrap();

        let messages = db.get_messages("chat-1").unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, MessageRole::User);
        assert_eq!(messages[0].content, "Hello");
        assert_eq!(messages[1].role, MessageRole::Assistant);
        assert_eq!(messages[1].content, "Hi there!");
    }

    #[test]
    fn messages_ordered_by_creation_time() {
        let db = ChatDb::in_memory().unwrap();

        db.create_chat("chat-1", "Test").unwrap();

        db.add_message("msg-1", "chat-1", MessageRole::User, "First")
            .unwrap();
        db.add_message("msg-2", "chat-1", MessageRole::User, "Second")
            .unwrap();
        db.add_message("msg-3", "chat-1", MessageRole::User, "Third")
            .unwrap();

        let messages = db.get_messages("chat-1").unwrap();
        assert_eq!(messages[0].content, "First");
        assert_eq!(messages[1].content, "Second");
        assert_eq!(messages[2].content, "Third");
    }

    #[test]
    fn deletes_message() {
        let db = ChatDb::in_memory().unwrap();

        db.create_chat("chat-1", "Test").unwrap();
        db.add_message("msg-1", "chat-1", MessageRole::User, "Hello")
            .unwrap();

        let deleted = db.delete_message("msg-1").unwrap();
        assert!(deleted);

        let messages = db.get_messages("chat-1").unwrap();
        assert!(messages.is_empty());
    }

    #[test]
    fn deleting_chat_deletes_messages() {
        let db = ChatDb::in_memory().unwrap();

        db.create_chat("chat-1", "Test").unwrap();
        db.add_message("msg-1", "chat-1", MessageRole::User, "Hello")
            .unwrap();
        db.add_message("msg-2", "chat-1", MessageRole::Assistant, "Hi")
            .unwrap();

        db.delete_chat("chat-1").unwrap();

        let messages = db.get_messages("chat-1").unwrap();
        assert!(messages.is_empty());
    }

    #[test]
    fn adding_message_updates_chat_timestamp() {
        let db = ChatDb::in_memory().unwrap();

        let chat = db.create_chat("chat-1", "Test").unwrap();
        let original_updated = chat.updated_at;

        // Small delay to ensure timestamp difference
        std::thread::sleep(std::time::Duration::from_millis(10));

        db.add_message("msg-1", "chat-1", MessageRole::User, "Hello")
            .unwrap();

        let updated_chat = db.get_chat("chat-1").unwrap().unwrap();
        assert!(updated_chat.updated_at > original_updated);
    }

    #[test]
    fn get_nonexistent_chat_returns_none() {
        let db = ChatDb::in_memory().unwrap();
        let chat = db.get_chat("nonexistent").unwrap();
        assert!(chat.is_none());
    }

    #[test]
    fn message_role_serialization() {
        assert_eq!(MessageRole::User.to_string(), "user");
        assert_eq!(MessageRole::Assistant.to_string(), "assistant");

        assert_eq!("user".parse::<MessageRole>().unwrap(), MessageRole::User);
        assert_eq!(
            "assistant".parse::<MessageRole>().unwrap(),
            MessageRole::Assistant
        );
    }
}
