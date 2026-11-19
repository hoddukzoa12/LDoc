// Converts between the core's Document and a Univer Docs snapshot. Each block
// is one paragraph: its text and paragraph mark carry one text run with the
// block's size and weight, and the paragraph carries the alignment.

import {
  BooleanNumber,
  DocumentFlavor,
  HorizontalAlign,
  type IDocumentData,
  type IParagraph,
  type ITextRun,
  LocaleType,
} from "@univerjs/presets";
import type { Align } from "./bindings/Align";
import type { Block } from "./bindings/Block";
import type { Document } from "./bindings/Document";

/** The page the DOCX writer uses: A4 with 30 mm margins, in 96-DPI pixels. */
const PAGE = { width: 794, height: 1123 };
const MARGIN = 113;
/** The DOCX writer's font and body size, for text typed where no run applies. */
const FONT = "바탕";
const BODY_PT = 12;

const TO_UNIVER: Record<Align, HorizontalAlign> = {
  left: HorizontalAlign.LEFT,
  center: HorizontalAlign.CENTER,
  right: HorizontalAlign.RIGHT,
  justify: HorizontalAlign.JUSTIFIED,
};

const FROM_UNIVER: Partial<Record<HorizontalAlign, Align>> = {
  [HorizontalAlign.CENTER]: "center",
  [HorizontalAlign.RIGHT]: "right",
  [HorizontalAlign.JUSTIFIED]: "justify",
  [HorizontalAlign.BOTH]: "justify",
  [HorizontalAlign.DISTRIBUTED]: "justify",
};

/** Control characters Univer uses as markers (page breaks, custom blocks, ranges). Tab stays. */
const MARKERS = /[\u0000-\u0008\u000a-\u001f]/g;

export function toUniver(document: Document): IDocumentData {
  let dataStream = "";
  const textRuns: ITextRun[] = [];
  const paragraphs: IParagraph[] = [];
  document.blocks.forEach((block, index) => {
    const st = dataStream.length;
    dataStream += `${block.text}\r`;
    textRuns.push({
      st,
      ed: dataStream.length,
      ts: { fs: block.size_pt, bl: block.bold ? BooleanNumber.TRUE : BooleanNumber.FALSE },
    });
    paragraphs.push({
      startIndex: dataStream.length - 1,
      paragraphId: `p${index}`,
      paragraphStyle: { horizontalAlign: TO_UNIVER[block.align] },
    });
  });
  return {
    id: "draft",
    locale: LocaleType.KO_KR,
    documentStyle: {
      documentFlavor: DocumentFlavor.TRADITIONAL,
      pageSize: PAGE,
      marginTop: MARGIN,
      marginBottom: MARGIN,
      marginLeft: MARGIN,
      marginRight: MARGIN,
      textStyle: { ff: FONT, fs: BODY_PT },
    },
    body: {
      dataStream: `${dataStream}\n`,
      textRuns,
      paragraphs,
      sectionBreaks: [{ sectionId: "s0", startIndex: dataStream.length }],
    },
  };
}

/** Reads each paragraph's style from its first character, or its paragraph mark when empty. */
export function fromUniver(snapshot: IDocumentData): Document {
  const body = snapshot.body;
  if (!body) return { blocks: [] };
  const paragraphs = body.paragraphs ?? [];
  const runs = body.textRuns ?? [];
  const blocks = paragraphs.map((paragraph, index): Block => {
    const start = (paragraphs[index - 1]?.startIndex ?? -1) + 1;
    const run = runs.find((candidate) => candidate.st <= start && start < candidate.ed);
    const style = { ...snapshot.documentStyle.textStyle, ...run?.ts };
    const align = paragraph.paragraphStyle?.horizontalAlign;
    return {
      text: body.dataStream.slice(start, paragraph.startIndex).replace(MARKERS, ""),
      align: (align === undefined ? undefined : FROM_UNIVER[align]) ?? "left",
      bold: style.bl === BooleanNumber.TRUE,
      size_pt: Math.round(style.fs ?? BODY_PT),
    };
  });
  return { blocks };
}
