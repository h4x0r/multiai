//! Export chat conversations to PDF and DOCX formats.

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
    output.push_str(&format!("*Exported: {}*\n\n---\n\n", chat.created_at));

    // Messages
    for msg in &chat.messages {
        let role_label = match msg.role.as_str() {
            "user" => "**You**",
            "assistant" => "**Assistant**",
            _ => &msg.role,
        };

        output.push_str(&format!("{} *({})*\n\n", role_label, msg.created_at));
        output.push_str(&msg.content);
        output.push_str("\n\n---\n\n");
    }

    Ok(output.into_bytes())
}

fn export_to_pdf(chat: &ExportChat) -> Result<Vec<u8>, String> {
    // Simple PDF generation using raw PDF structure
    // For production, consider using a proper PDF library like printpdf
    let content = generate_pdf_content(chat);
    Ok(content)
}

fn generate_pdf_content(chat: &ExportChat) -> Vec<u8> {
    let mut text_content = String::new();

    // Build text content for PDF
    text_content.push_str(&format!("{}\n\n", chat.title));

    for msg in &chat.messages {
        let role = if msg.role == "user" { "You" } else { "Assistant" };
        text_content.push_str(&format!("[{}]\n{}\n\n", role, msg.content));
    }

    // Create minimal PDF structure
    let text_lines: Vec<&str> = text_content.lines().collect();
    let mut stream_content = String::new();

    stream_content.push_str("BT\n");
    stream_content.push_str("/F1 12 Tf\n");

    let mut y = 750.0;
    for line in text_lines {
        if y < 50.0 {
            break; // Simple pagination - stop at bottom
        }
        // Escape special PDF characters
        let escaped = line
            .replace('\\', "\\\\")
            .replace('(', "\\(")
            .replace(')', "\\)");
        stream_content.push_str(&format!("50 {} Td\n", y));
        stream_content.push_str(&format!("({}) Tj\n", escaped));
        y -= 14.0;
    }
    stream_content.push_str("ET\n");

    let stream_bytes = stream_content.as_bytes();
    let stream_len = stream_bytes.len();

    let mut pdf = String::new();
    pdf.push_str("%PDF-1.4\n");

    // Catalog
    pdf.push_str("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

    // Pages
    pdf.push_str("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

    // Page
    pdf.push_str("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n");

    // Content stream
    pdf.push_str(&format!(
        "4 0 obj\n<< /Length {} >>\nstream\n{}\nendstream\nendobj\n",
        stream_len, stream_content
    ));

    // Font
    pdf.push_str("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");

    // Cross-reference table
    let xref_pos = pdf.len();
    pdf.push_str("xref\n0 6\n");
    pdf.push_str("0000000000 65535 f \n");
    pdf.push_str("0000000009 00000 n \n");
    pdf.push_str("0000000058 00000 n \n");
    pdf.push_str("0000000115 00000 n \n");
    pdf.push_str(&format!("0000000{:03} 00000 n \n", 250));
    pdf.push_str(&format!("0000000{:03} 00000 n \n", 250 + stream_len + 50));

    // Trailer
    pdf.push_str("trailer\n<< /Size 6 /Root 1 0 R >>\n");
    pdf.push_str(&format!("startxref\n{}\n%%EOF\n", xref_pos));

    pdf.into_bytes()
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

        assert!(content.contains("**You**"));
        assert!(content.contains("**Assistant**"));
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

        // Check PDF header
        assert!(result.starts_with(b"%PDF-1.4"));
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
