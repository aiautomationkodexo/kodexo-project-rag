import "server-only";

import {
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  convertInchesToTwip,
} from "docx";
import type { StoredCaseStudyOutline } from "@/lib/types";

/**
 * Renders a case study outline as a DOCX (migration 0018).
 *
 * ── WHY A REAL DOCX AND NOT MARKDOWN ──────────────────────────────────────
 * This file is handed to a BD or marketing writer who finishes it in Word.
 * Native heading styles are what make that possible — the navigation pane,
 * the style dropdown and "update table of contents" all key off them, and a
 * Markdown file pasted into Word arrives as one undifferentiated block.
 *
 * ── FONTS ARE NAMED, NOT EMBEDDED ─────────────────────────────────────────
 * A DOCX references fonts by name; it does not carry them. Unbounded and
 * Manrope (src/lib/fonts.ts) are almost certainly absent on the reader's
 * machine, and Word's fallback for a missing font is silent and ugly. So this
 * document uses the design system's TYPOGRAPHIC STRUCTURE — the size ramp,
 * the weight contrast, the uppercase tracked kicker — with families that
 * exist everywhere. Reproducing the brand exactly would need a .dotx
 * template, which is a design deliverable, not a code one.
 *
 * ── NO COLOUR EXCEPT ONE ──────────────────────────────────────────────────
 * DESIGN.md rations red to one run per view, and that principle survives the
 * medium change: red appears ONLY on the disclosure notice, because it is the
 * one thing in the document that demands action before external use.
 * Everything else is the neutral ramp. A document that tints every heading
 * spends the ration on decoration — see the dashboard shell note in
 * CLAUDE.md.
 */

/** Kodexo red, from globals.css. The document's single accent. */
const RED = "D0021B";
/** The neutral ramp, sampled for print: body ink, and muted guidance text. */
const INK = "1A1A1A";
const N600 = "5C5C5C";
const N400 = "9B9B9B";

const BODY_FONT = "Calibri";
/** Word's default sans pairs acceptably and exists on every install. */
const HEADING_FONT = "Calibri";

/** Half-points: docx sizes are in half-points, so 24 = 12pt. */
const pt = (points: number) => points * 2;

function kicker(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 60 },
    children: [
      new TextRun({
        // The `kicker` utility: uppercase, tracked, mono-ish, small.
        text: text.toUpperCase(),
        font: BODY_FONT,
        size: pt(8),
        bold: true,
        color: N600,
        // Tracking, in twentieths of a point — the .12em of the web kicker.
        characterSpacing: 24,
      }),
    ],
  });
}

/** Guidance shown in place of content when a section came back empty. */
function briefParagraph(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({
        text,
        font: BODY_FONT,
        size: pt(10),
        color: N400,
        italics: true,
      }),
    ],
  });
}

export type CaseStudyDocxInput = {
  title: string;
  outline: StoredCaseStudyOutline;
  /** Section briefs, for the empty-section guidance. Keyed by section key. */
  briefs: Map<string, string>;
  /** Rendered into the footer so a stray copy can be traced. */
  generatedAt: Date;
  /**
   * Shown in the footer when the project's NDA terms restrict the material.
   * Null when disclosure() permits naming the client.
   *
   * ⚠ This is a NOTICE, not a control. The prompt asks the model not to name
   *   the client; nothing verifies it did. Never phrase it as a guarantee.
   */
  disclosureNotice: string | null;
};

export async function renderCaseStudyDocx(
  input: CaseStudyDocxInput,
): Promise<Buffer> {
  const children: Paragraph[] = [];

  children.push(kicker("Case study outline — draft"));

  children.push(
    new Paragraph({
      spacing: { after: input.outline.headline ? 80 : 240 },
      children: [
        new TextRun({
          text: input.title,
          font: HEADING_FONT,
          // The `statement` role: heaviest weight, largest size.
          size: pt(26),
          bold: true,
          color: INK,
        }),
      ],
    }),
  );

  if (input.outline.headline) {
    children.push(
      new Paragraph({
        spacing: { after: 240 },
        children: [
          new TextRun({
            text: input.outline.headline,
            font: BODY_FONT,
            size: pt(13),
            color: N600,
          }),
        ],
      }),
    );
  }

  // A rule under the masthead. Cheap, and it does the work the card border
  // does on the web page.
  children.push(
    new Paragraph({
      spacing: { after: 240 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: N400 },
      },
      children: [],
    }),
  );

  /*
   * ⚠ ARRAY ORDER, UNCONDITIONALLY. No sort, no lookup keyed on section key,
   *   no per-key special case. §15.12's rule for summary sections applies
   *   with equal force here: the order is the document's structure, and
   *   CASE_STUDY_SECTIONS is its only author.
   */
  for (const section of input.outline.sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 280, after: 100 },
        children: [
          new TextRun({
            text: section.label,
            font: HEADING_FONT,
            size: pt(14),
            bold: true,
            color: INK,
          }),
        ],
      }),
    );

    const content = section.content.trim();

    if (content) {
      // Blank-line-separated paragraphs survive as paragraphs. The prompt asks
      // for plain prose, but a model will still occasionally emit two.
      for (const block of content.split(/\n{2,}/)) {
        const text = block.trim();
        if (!text) continue;
        children.push(
          new Paragraph({
            spacing: { after: 120, line: 276 },
            children: [
              new TextRun({
                text,
                font: BODY_FONT,
                size: pt(11),
                color: INK,
              }),
            ],
          }),
        );
      }
    } else {
      const brief = input.briefs.get(section.key);
      children.push(
        briefParagraph(
          brief
            ? `To write: ${brief}`
            : "Nothing in the project material covers this section yet.",
        ),
      );
    }
  }

  // ── Provenance footer ───────────────────────────────────────────────────
  // In the body flow rather than a real footer: this must travel with the
  // text when someone copies the whole document into another file, which a
  // page footer does not.
  children.push(
    new Paragraph({
      spacing: { before: 400, after: 60 },
      border: {
        top: { style: BorderStyle.SINGLE, size: 6, space: 8, color: N400 },
      },
      children: [],
    }),
  );

  const stamp = input.generatedAt.toISOString().slice(0, 16).replace("T", " ");
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          // Named as a draft, in the file itself. The provenance badge on the
          // web page cannot travel with a downloaded document, and an
          // unlabelled AI draft is one paste away from being taken for
          // reviewed copy.
          text:
            `AI-generated outline, unreviewed — drafted from the project's ` +
            `uploaded material on ${stamp} UTC. Verify every figure and quote ` +
            `against the source documents before any external use.`,
          font: BODY_FONT,
          size: pt(8),
          color: N600,
        }),
      ],
    }),
  );

  if (input.disclosureNotice) {
    children.push(
      new Paragraph({
        spacing: { before: 60 },
        children: [
          new TextRun({
            text: input.disclosureNotice,
            font: BODY_FONT,
            size: pt(8),
            bold: true,
            color: RED,
          }),
        ],
      }),
    );
  }

  const document = new Document({
    // Shows in Word's document properties — the only place a reader can check
    // where a stray file came from.
    title: `${input.title} — case study outline`,
    description: "AI-generated draft outline. Unreviewed.",
    creator: "Kodexo Labs portfolio knowledge base",
    styles: {
      default: {
        document: {
          run: { font: BODY_FONT, size: pt(11), color: INK },
          paragraph: { spacing: { line: 276 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            // A4, matching DESIGN.md's print-first origin.
            size: { width: convertInchesToTwip(8.27), height: convertInchesToTwip(11.69) },
            margin: {
              top: convertInchesToTwip(0.9),
              bottom: convertInchesToTwip(0.9),
              left: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
            },
          },
        },
        children,
      },
    ],
  });

  // Buffer, not Blob: this goes straight to Storage's upload, which takes a
  // Buffer/ArrayBuffer, and to Response, which accepts both.
  return Packer.toBuffer(document);
}

/**
 * The download filename.
 *
 * Sanitised hard, because this string ends up in a Content-Disposition header
 * via the signed URL and in a storage key. Anything outside a conservative
 * allowlist becomes a hyphen — a filename is not worth a header-injection
 * surface, and Windows additionally forbids \ / : * ? " < > |.
 */
export function caseStudyFilename(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .toLowerCase();

  return `${slug || "project"}-case-study-outline.docx`;
}

/** The canonical DOCX MIME. Already in the bucket allowlist (0004). */
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
