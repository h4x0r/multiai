//! Export chat conversations to PDF and DOCX formats.

use printpdf::*;
use std::io::Write;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

/// Chat message for export.
#[derive(Debug, Clone)]
pub struct ExportMessage {
    pub role: String,
    pub content: String,
    pub created_at: String,
}

/// Chat conversation for export.
#[derive(Debug, Clone)]
pub struct ExportChat {
    pub title: String,
    pub messages: Vec<ExportMessage>,
    pub created_at: String,
}

/// Export format options.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    Pdf,
    Docx,
    Markdown,
}

impl ExportFormat {
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_lowercase().as_str() {
            "pdf" => Some(Self::Pdf),
            "docx" => Some(Self::Docx),
            "md" | "markdown" => Some(Self::Markdown),
            _ => None,
        }
    }

    pub fn content_type(&self) -> &'static str {
        match self {
            Self::Pdf => "application/pdf",
            Self::Docx => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            Self::Markdown => "text/markdown",
        }
    }

    pub fn extension(&self) -> &'static str {
        match self {
            Self::Pdf => "pdf",
            Self::Docx => "docx",
            Self::Markdown => "md",
        }
    }
}

/// Export a chat to the specified format.
pub fn export_chat(chat: &ExportChat, format: ExportFormat) -> Result<Vec<u8>, String> {
    match format {
        ExportFormat::Pdf => export_to_pdf(chat),
        ExportFormat::Docx => export_to_docx(chat),
        ExportFormat::Markdown => export_to_markdown(chat),
    }
}

fn export_to_markdown(chat: &ExportChat) -> Result<Vec<u8>, String> {
    let mut output = String::new();

    // Title
    output.push_str(&format!("# {}\n\n", chat.title));
    output.push_str(&format!("*Exported: {}*\n\n---\n\n", format_timestamp(&chat.created_at)));

    // Messages
    for msg in &chat.messages {
        let timestamp = format_timestamp(&msg.created_at);

        // Timestamp on its own line, then role header
        output.push_str(&format!("*{}*\n", timestamp));
        if msg.role == "user" {
            output.push_str("**User:**\n");
        } else {
            // Use the role as-is (could be model name like "Alpha Glm 4.7")
            output.push_str(&format!("**{}:**\n", msg.role));
        }

        output.push_str(&msg.content);
        output.push_str("\n\n---\n\n");
    }

    Ok(output.into_bytes())
}

/// Format ISO timestamp to readable format (e.g., "Jan 3, 2026 7:24 PM")
fn format_timestamp(iso: &str) -> String {
    // Try to parse ISO 8601 format and convert to readable
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(iso) {
        dt.format("%b %d, %Y %I:%M %p").to_string()
    } else {
        // Fallback: just return as-is
        iso.to_string()
    }
}

fn export_to_pdf(chat: &ExportChat) -> Result<Vec<u8>, String> {
    // Create PDF document with A4 page size
    let page_width = Mm(210.0);
    let page_height = Mm(297.0);
    let (doc, page1, layer1) =
        PdfDocument::new(&chat.title, page_width, page_height, "Layer 1");

    // Use built-in Helvetica font
    let font = doc
        .add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| format!("Failed to add font: {}", e))?;
    let font_bold = doc
        .add_builtin_font(BuiltinFont::HelveticaBold)
        .map_err(|e| format!("Failed to add font: {}", e))?;

    let mut current_layer = doc.get_page(page1).get_layer(layer1);
    let mut y_pos = Mm(280.0); // Start near top
    let line_height = Mm(5.0);
    let margin_left = Mm(15.0);
    let page_bottom = Mm(20.0);

    // Title
    current_layer.use_text(&chat.title, 16.0, margin_left, y_pos, &font_bold);
    y_pos -= Mm(10.0);

    // Messages
    for msg in &chat.messages {
        // Check if we need a new page
        if y_pos < page_bottom + Mm(20.0) {
            let (new_page, new_layer) = doc.add_page(page_width, page_height, "Layer 1");
            current_layer = doc.get_page(new_page).get_layer(new_layer);
            y_pos = Mm(280.0);
        }

        // Timestamp
        let timestamp = format_timestamp(&msg.created_at);
        current_layer.use_text(&timestamp, 9.0, margin_left, y_pos, &font);
        y_pos -= line_height;

        // Role header
        let role_label = if msg.role == "user" {
            "User:".to_string()
        } else {
            format!("{}:", msg.role)
        };
        current_layer.use_text(&role_label, 11.0, margin_left, y_pos, &font_bold);
        y_pos -= line_height;

        // Content - split by lines and wrap long lines
        for line in msg.content.lines() {
            // Simple word wrapping at ~80 chars
            let wrapped = wrap_text(line, 80);
            for wrapped_line in wrapped {
                if y_pos < page_bottom {
                    let (new_page, new_layer) = doc.add_page(page_width, page_height, "Layer 1");
                    current_layer = doc.get_page(new_page).get_layer(new_layer);
                    y_pos = Mm(280.0);
                }
                current_layer.use_text(&wrapped_line, 10.0, margin_left, y_pos, &font);
                y_pos -= line_height;
            }
        }

        y_pos -= Mm(5.0); // Extra space between messages
    }

    // Save to bytes
    let buffer = doc.save_to_bytes().map_err(|e| format!("Failed to save PDF: {}", e))?;
    Ok(buffer)
}

/// Simple word wrapping for PDF text
fn wrap_text(text: &str, max_chars: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current_line = String::new();

    for word in text.split_whitespace() {
        if current_line.is_empty() {
            current_line = word.to_string();
        } else if current_line.len() + 1 + word.len() <= max_chars {
            current_line.push(' ');
            current_line.push_str(word);
        } else {
            lines.push(current_line);
            current_line = word.to_string();
        }
    }

    if !current_line.is_empty() {
        lines.push(current_line);
    }

    if lines.is_empty() {
        lines.push(String::new());
    }

    lines
}

fn export_to_docx(chat: &ExportChat) -> Result<Vec<u8>, String> {
    let mut buffer = Vec::new();
    {
        let mut zip = ZipWriter::new(std::io::Cursor::new(&mut buffer));
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        // [Content_Types].xml
        let content_types = r#"<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"#;
        zip.start_file("[Content_Types].xml", options)
            .map_err(|e| format!("Failed to create content types: {}", e))?;
        zip.write_all(content_types.as_bytes())
            .map_err(|e| format!("Failed to write content types: {}", e))?;

        // _rels/.rels
        let rels = r#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#;
        zip.start_file("_rels/.rels", options)
            .map_err(|e| format!("Failed to create rels: {}", e))?;
        zip.write_all(rels.as_bytes())
            .map_err(|e| format!("Failed to write rels: {}", e))?;

        // word/document.xml
        let document = generate_docx_document(chat);
        zip.start_file("word/document.xml", options)
            .map_err(|e| format!("Failed to create document: {}", e))?;
        zip.write_all(document.as_bytes())
            .map_err(|e| format!("Failed to write document: {}", e))?;

        zip.finish()
            .map_err(|e| format!("Failed to finalize DOCX: {}", e))?;
    }

    Ok(buffer)
}

fn generate_docx_document(chat: &ExportChat) -> String {
    let mut paragraphs = String::new();

    // Title paragraph (bold)
    paragraphs.push_str(&format!(
        r#"<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>{}</w:t></w:r></w:p>"#,
        escape_xml(&chat.title)
    ));

    // Messages
    for msg in &chat.messages {
        let role_label = if msg.role == "user" {
            "You"
        } else {
            "Assistant"
        };

        // Role header (bold)
        paragraphs.push_str(&format!(
            r#"<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>[{}]</w:t></w:r></w:p>"#,
            role_label
        ));

        // Content - split by newlines
        for line in msg.content.lines() {
            paragraphs.push_str(&format!(
                r#"<w:p><w:r><w:t>{}</w:t></w:r></w:p>"#,
                escape_xml(line)
            ));
        }

        // Empty paragraph as separator
        paragraphs.push_str("<w:p/>");
    }

    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    {}
  </w:body>
</w:document>"#,
        paragraphs
    )
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_chat() -> ExportChat {
        ExportChat {
            title: "Test Conversation".to_string(),
            created_at: "2024-01-01T12:00:00Z".to_string(),
            messages: vec![
                ExportMessage {
                    role: "user".to_string(),
                    content: "Hello, how are you?".to_string(),
                    created_at: "2024-01-01T12:00:00Z".to_string(),
                },
                ExportMessage {
                    role: "assistant".to_string(),
                    content: "I'm doing great! How can I help you today?".to_string(),
                    created_at: "2024-01-01T12:00:01Z".to_string(),
                },
            ],
        }
    }

    // =========================================================================
    // Format Detection Tests
    // =========================================================================

    #[test]
    fn detect_format_from_extension() {
        assert_eq!(ExportFormat::from_extension("pdf"), Some(ExportFormat::Pdf));
        assert_eq!(ExportFormat::from_extension("docx"), Some(ExportFormat::Docx));
        assert_eq!(ExportFormat::from_extension("md"), Some(ExportFormat::Markdown));
        assert_eq!(ExportFormat::from_extension("exe"), None);
    }

    #[test]
    fn format_content_types() {
        assert_eq!(ExportFormat::Pdf.content_type(), "application/pdf");
        assert_eq!(
            ExportFormat::Docx.content_type(),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
        assert_eq!(ExportFormat::Markdown.content_type(), "text/markdown");
    }

    // =========================================================================
    // Markdown Export Tests
    // =========================================================================

    #[test]
    fn export_markdown_includes_title() {
        let chat = sample_chat();
        let result = export_chat(&chat, ExportFormat::Markdown).unwrap();
        let content = String::from_utf8(result).unwrap();

        assert!(content.contains("# Test Conversation"));
    }

    #[test]
    fn export_markdown_includes_messages() {
        let chat = sample_chat();
        let result = export_chat(&chat, ExportFormat::Markdown).unwrap();
        let content = String::from_utf8(result).unwrap();

        assert!(content.contains("**User:**"));
        assert!(content.contains("**assistant:**")); // Role used as-is from message
        assert!(content.contains("Hello, how are you?"));
        assert!(content.contains("I'm doing great!"));
    }

    // =========================================================================
    // PDF Export Tests
    // =========================================================================

    #[test]
    fn export_pdf_creates_valid_pdf() {
        let chat = sample_chat();
        let result = export_chat(&chat, ExportFormat::Pdf).unwrap();

        // Check PDF header (version may vary)
        assert!(result.starts_with(b"%PDF-"));
        // Check PDF footer
        let content = String::from_utf8_lossy(&result);
        assert!(content.contains("%%EOF"));
    }

    #[test]
    fn export_pdf_includes_content() {
        let chat = sample_chat();
        let result = export_chat(&chat, ExportFormat::Pdf).unwrap();
        let content = String::from_utf8_lossy(&result);

        // PDF content streams contain the text
        assert!(content.contains("Test Conversation"));
    }

    // =========================================================================
    // DOCX Export Tests
    // =========================================================================

    #[test]
    fn export_docx_creates_valid_zip() {
        let chat = sample_chat();
        let result = export_chat(&chat, ExportFormat::Docx).unwrap();

        // DOCX is a ZIP file - check magic number
        assert!(result.len() > 4);
        assert_eq!(&result[0..4], b"PK\x03\x04");
    }

    #[test]
    fn export_docx_contains_required_files() {
        use std::io::Cursor;
        use zip::ZipArchive;

        let chat = sample_chat();
        let result = export_chat(&chat, ExportFormat::Docx).unwrap();

        let cursor = Cursor::new(result);
        let mut archive = ZipArchive::new(cursor).unwrap();

        // Check required files exist
        assert!(archive.by_name("[Content_Types].xml").is_ok());
        assert!(archive.by_name("_rels/.rels").is_ok());
        assert!(archive.by_name("word/document.xml").is_ok());
    }

    #[test]
    fn export_docx_document_contains_content() {
        use std::io::{Cursor, Read};
        use zip::ZipArchive;

        let chat = sample_chat();
        let result = export_chat(&chat, ExportFormat::Docx).unwrap();

        let cursor = Cursor::new(result);
        let mut archive = ZipArchive::new(cursor).unwrap();

        let mut document = String::new();
        archive
            .by_name("word/document.xml")
            .unwrap()
            .read_to_string(&mut document)
            .unwrap();

        assert!(document.contains("Test Conversation"));
        assert!(document.contains("Hello, how are you?"));
    }

    // =========================================================================
    // XML Escaping Tests
    // =========================================================================

    #[test]
    fn escapes_xml_special_characters() {
        let input = "Hello <world> & \"friends\"";
        let escaped = escape_xml(input);
        assert_eq!(escaped, "Hello &lt;world&gt; &amp; &quot;friends&quot;");
    }
}
