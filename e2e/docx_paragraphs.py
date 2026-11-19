"""Prints the paragraphs of a DOCX file as JSON: text, alignment, bold, size."""

import json
import sys

from docx import Document

paragraphs = []
for paragraph in Document(sys.argv[1]).paragraphs:
    run = paragraph.runs[0] if paragraph.runs else None
    paragraphs.append(
        {
            "text": paragraph.text,
            "align": paragraph.alignment.name if paragraph.alignment is not None else None,
            "bold": bool(run and run.bold),
            "size_pt": run.font.size.pt if run and run.font.size else None,
        }
    )
print(json.dumps(paragraphs, ensure_ascii=False))
