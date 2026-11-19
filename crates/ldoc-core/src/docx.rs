//! Writes a [`Document`] as a Word file: A4, one run per paragraph.

use crate::document::{Align, Block, Document};
use std::io::{self, Cursor, Write};
use zip::ZipWriter;
use zip::write::SimpleFileOptions;

const CONTENT_TYPES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#;

const RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;

const FONT: &str = "바탕";

/// A4 with 30 mm margins, in twentieths of a point.
const SECTION: &str = r#"<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1701" w:right="1701" w:bottom="1701" w:left="1701" w:header="851" w:footer="851" w:gutter="0"/></w:sectPr>"#;

pub fn to_docx(document: &Document) -> io::Result<Vec<u8>> {
    let mut archive = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default();
    for (name, content) in [
        ("[Content_Types].xml", CONTENT_TYPES.to_string()),
        ("_rels/.rels", RELS.to_string()),
        ("word/document.xml", document_xml(document)),
    ] {
        archive.start_file(name, options)?;
        archive.write_all(content.as_bytes())?;
    }
    Ok(archive.finish()?.into_inner())
}

fn document_xml(document: &Document) -> String {
    let paragraphs: String = document.blocks.iter().map(paragraph_xml).collect();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{paragraphs}{SECTION}</w:body></w:document>"#
    )
}

fn paragraph_xml(block: &Block) -> String {
    let align = match block.align {
        Align::Left => "left",
        Align::Center => "center",
        Align::Right => "right",
        Align::Justify => "both",
    };
    let bold = if block.bold { "<w:b/>" } else { "" };
    let half_points = u32::from(block.size_pt) * 2;
    let text = escape(&block.text);
    format!(
        r#"<w:p><w:pPr><w:jc w:val="{align}"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="{FONT}" w:hAnsi="{FONT}" w:eastAsia="{FONT}"/>{bold}<w:sz w:val="{half_points}"/><w:szCs w:val="{half_points}"/></w:rPr><w:t xml:space="preserve">{text}</w:t></w:r></w:p>"#
    )
}

fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            // Control characters are not allowed in XML 1.0.
            c if c.is_control() && c != '\t' => {}
            c => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn part(docx: &[u8], name: &str) -> String {
        let mut archive = zip::ZipArchive::new(Cursor::new(docx)).expect("a zip archive");
        let mut content = String::new();
        archive
            .by_name(name)
            .expect(name)
            .read_to_string(&mut content)
            .expect("utf-8");
        content
    }

    #[test]
    fn the_file_holds_each_paragraph_with_its_formatting() {
        let document = Document {
            blocks: vec![
                Block::title("지 급 명 령 신 청 서"),
                Block::body("본문입니다."),
            ],
        };
        let xml = part(&to_docx(&document).unwrap(), "word/document.xml");

        let title = xml.find("지 급 명 령 신 청 서").expect("title text");
        let body = xml.find("본문입니다.").expect("body text");
        assert!(title < body, "paragraphs keep their order");
        assert!(xml[..title].contains(r#"<w:jc w:val="center"/>"#));
        assert!(xml[..title].contains("<w:b/>"));
        assert!(xml[..title].contains(r#"<w:sz w:val="36"/>"#));
        assert!(xml[title..body].contains(r#"<w:jc w:val="both"/>"#));
        assert!(!xml[title..body].contains("<w:b/>"));
    }

    #[test]
    fn markup_characters_in_text_stay_text() {
        let document = Document {
            blocks: vec![Block::body("A&B <주식회사> \u{0007}")],
        };
        let xml = part(&to_docx(&document).unwrap(), "word/document.xml");
        assert!(xml.contains("A&amp;B &lt;주식회사&gt; </w:t>"));
    }

    #[test]
    fn the_package_declares_its_main_part() {
        let docx = to_docx(&Document { blocks: vec![] }).unwrap();
        assert!(part(&docx, "[Content_Types].xml").contains("/word/document.xml"));
        assert!(part(&docx, "_rels/.rels").contains(r#"Target="word/document.xml""#));
    }
}
