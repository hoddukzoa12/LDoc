use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A drafted document as a list of paragraphs. This is the one format the
/// drafting code, the editor and the DOCX writer exchange.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Document {
    pub blocks: Vec<Block>,
}

/// One paragraph. An empty `text` is a blank line.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Block {
    pub text: String,
    pub align: Align,
    pub bold: bool,
    pub size_pt: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Align {
    Left,
    Center,
    Right,
    Justify,
}

const BODY_PT: u8 = 12;

impl Block {
    pub fn title(text: impl Into<String>) -> Block {
        Block {
            text: text.into(),
            align: Align::Center,
            bold: true,
            size_pt: 18,
        }
    }

    pub fn heading(text: impl Into<String>) -> Block {
        Block {
            text: text.into(),
            align: Align::Center,
            bold: true,
            size_pt: 14,
        }
    }

    pub fn body(text: impl Into<String>) -> Block {
        Block {
            text: text.into(),
            align: Align::Justify,
            bold: false,
            size_pt: BODY_PT,
        }
    }

    pub fn left(text: impl Into<String>) -> Block {
        Block {
            text: text.into(),
            align: Align::Left,
            bold: false,
            size_pt: BODY_PT,
        }
    }

    pub fn right(text: impl Into<String>) -> Block {
        Block {
            text: text.into(),
            align: Align::Right,
            bold: false,
            size_pt: BODY_PT,
        }
    }

    pub fn blank() -> Block {
        Block::body("")
    }
}

impl Document {
    /// The paragraphs joined by newlines, for reading and searching.
    pub fn plain_text(&self) -> String {
        self.blocks
            .iter()
            .map(|block| block.text.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    }
}
