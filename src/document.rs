//! Document processing for PDF and DOCX files.
//!
//! Extracts text content from uploaded documents to include in chat context.

use quick_xml::events::Event;
use quick_xml::Reader;
use std::io::{Cursor, Read};
use zip::ZipArchive;

/// Supported document types.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocumentType {
    Pdf,
    Docx,
    Text,
}

impl DocumentType {
    /// Detect document type from file extension.
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_lowercase().as_str() {
            "pdf" => Some(Self::Pdf),
            "docx" => Some(Self::Docx),
            "txt" | "md" | "text" => Some(Self::Text),
            _ => None,
        }
    }

    /// Detect document type from MIME type.
    pub fn from_mime(mime: &str) -> Option<Self> {
        match mime {
            "application/pdf" => Some(Self::Pdf),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => {
                Some(Self::Docx)
            }
            "text/plain" | "text/markdown" => Some(Self::Text),
            _ => None,
        }
    }
}

/// Result of document extraction.
#[derive(Debug, Clone)]
pub struct ExtractedDocument {
    pub text: String,
    pub doc_type: DocumentType,
    pub page_count: Option<usize>,
    pub word_count: usize,
}

/// Extract text from a document.
pub fn extract_text(data: &[u8], doc_type: DocumentType) -> Result<ExtractedDocument, String> {
    match doc_type {
        DocumentType::Pdf => extract_pdf(data),
        DocumentType::Docx => extract_docx(data),
        DocumentType::Text => extract_text_file(data),
    }
}

fn extract_pdf(data: &[u8]) -> Result<ExtractedDocument, String> {
    let text = pdf_extract::extract_text_from_mem(data)
        .map_err(|e| format!("PDF extraction failed: {}", e))?;

    let word_count = text.split_whitespace().count();

    // Count pages by looking for page markers in the PDF
    let page_count = count_pdf_pages(data);

    Ok(ExtractedDocument {
        text,
        doc_type: DocumentType::Pdf,
        page_count: Some(page_count),
        word_count,
    })
}

fn count_pdf_pages(data: &[u8]) -> usize {
    // Simple heuristic: count "/Type /Page" occurrences
    let data_str = String::from_utf8_lossy(data);
    data_str.matches("/Type /Page").count().max(1)
}

fn extract_docx(data: &[u8]) -> Result<ExtractedDocument, String> {
    let cursor = Cursor::new(data);
    let mut archive =
        ZipArchive::new(cursor).map_err(|e| format!("Invalid DOCX (not a ZIP): {}", e))?;

    // Find and read word/document.xml
    let mut document_xml = String::new();
    {
        let mut file = archive
            .by_name("word/document.xml")
            .map_err(|_| "Invalid DOCX: missing word/document.xml")?;
        file.read_to_string(&mut document_xml)
            .map_err(|e| format!("Failed to read document.xml: {}", e))?;
    }

    // Parse XML and extract text from w:t elements
    let text = extract_text_from_docx_xml(&document_xml)?;
    let word_count = text.split_whitespace().count();

    Ok(ExtractedDocument {
        text,
        doc_type: DocumentType::Docx,
        page_count: None, // DOCX doesn't have fixed pages
        word_count,
    })
}

fn extract_text_from_docx_xml(xml: &str) -> Result<String, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut text_parts = Vec::new();
    let mut in_text_element = false;
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                let name = e.name();
                let local_name = name.local_name();
                if local_name.as_ref() == b"t" {
                    in_text_element = true;
                } else if local_name.as_ref() == b"p" {
                    // New paragraph - add newline if we have content
                    if !text_parts.is_empty() {
                        text_parts.push("\n".to_string());
                    }
                }
            }
            Ok(Event::Text(e)) => {
                if in_text_element {
                    let text = e.unescape().map_err(|e| format!("XML decode error: {}", e))?;
                    text_parts.push(text.to_string());
                }
            }
            Ok(Event::End(e)) => {
                let name = e.name();
                let local_name = name.local_name();
                if local_name.as_ref() == b"t" {
                    in_text_element = false;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parsing error: {}", e)),
            _ => {}
        }
        buf.clear();
    }

    Ok(text_parts.join("").trim().to_string())
}

fn extract_text_file(data: &[u8]) -> Result<ExtractedDocument, String> {
    let text = String::from_utf8(data.to_vec())
        .map_err(|e| format!("Invalid UTF-8: {}", e))?;
    let word_count = text.split_whitespace().count();

    Ok(ExtractedDocument {
        text,
        doc_type: DocumentType::Text,
        page_count: None,
        word_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // =========================================================================
    // DocumentType Detection Tests
    // =========================================================================

    #[test]
    fn detect_pdf_from_extension() {
        assert_eq!(DocumentType::from_extension("pdf"), Some(DocumentType::Pdf));
        assert_eq!(DocumentType::from_extension("PDF"), Some(DocumentType::Pdf));
    }

    #[test]
    fn detect_docx_from_extension() {
        assert_eq!(DocumentType::from_extension("docx"), Some(DocumentType::Docx));
        assert_eq!(DocumentType::from_extension("DOCX"), Some(DocumentType::Docx));
    }

    #[test]
    fn detect_text_from_extension() {
        assert_eq!(DocumentType::from_extension("txt"), Some(DocumentType::Text));
        assert_eq!(DocumentType::from_extension("md"), Some(DocumentType::Text));
    }

    #[test]
    fn unknown_extension_returns_none() {
        assert_eq!(DocumentType::from_extension("exe"), None);
        assert_eq!(DocumentType::from_extension("jpg"), None);
    }

    #[test]
    fn detect_pdf_from_mime() {
        assert_eq!(
            DocumentType::from_mime("application/pdf"),
            Some(DocumentType::Pdf)
        );
    }

    #[test]
    fn detect_docx_from_mime() {
        assert_eq!(
            DocumentType::from_mime(
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            ),
            Some(DocumentType::Docx)
        );
    }

    // =========================================================================
    // Text Extraction Tests
    // =========================================================================

    #[test]
    fn extract_plain_text_file() {
        let content = b"Hello, this is a test document with some words.";
        let result = extract_text(content, DocumentType::Text).unwrap();

        assert_eq!(result.text, "Hello, this is a test document with some words.");
        assert_eq!(result.doc_type, DocumentType::Text);
        assert_eq!(result.word_count, 9);
        assert_eq!(result.page_count, None);
    }

    #[test]
    fn extract_text_counts_words_correctly() {
        let content = b"One two three four five";
        let result = extract_text(content, DocumentType::Text).unwrap();
        assert_eq!(result.word_count, 5);
    }

    #[test]
    fn extract_text_handles_empty_file() {
        let content = b"";
        let result = extract_text(content, DocumentType::Text).unwrap();
        assert_eq!(result.text, "");
        assert_eq!(result.word_count, 0);
    }

    #[test]
    fn extract_text_rejects_invalid_utf8() {
        let content = &[0xff, 0xfe, 0x00, 0x01]; // Invalid UTF-8
        let result = extract_text(content, DocumentType::Text);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid UTF-8"));
    }

    // =========================================================================
    // PDF Extraction Tests (TDD - will fail until implemented)
    // =========================================================================

    #[test]
    fn extract_pdf_returns_text() {
        // Minimal PDF structure for testing
        let pdf_data = include_bytes!("../tests/fixtures/sample.pdf");
        let result = extract_text(pdf_data, DocumentType::Pdf);

        assert!(
            result.is_ok(),
            "PDF extraction should succeed, got: {:?}",
            result.as_ref().err()
        );
        let doc = result.unwrap();
        assert!(!doc.text.is_empty(), "Extracted text should not be empty");
        assert_eq!(doc.doc_type, DocumentType::Pdf);
    }

    // =========================================================================
    // DOCX Extraction Tests (TDD - will fail until implemented)
    // =========================================================================

    #[test]
    fn extract_docx_returns_text() {
        let docx_data = include_bytes!("../tests/fixtures/sample.docx");
        let result = extract_text(docx_data, DocumentType::Docx);

        assert!(result.is_ok(), "DOCX extraction should succeed");
        let doc = result.unwrap();
        assert!(!doc.text.is_empty(), "Extracted text should not be empty");
        assert_eq!(doc.doc_type, DocumentType::Docx);
    }
}
