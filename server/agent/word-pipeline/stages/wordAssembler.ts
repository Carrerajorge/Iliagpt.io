import { v4 as uuidv4 } from "uuid";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, convertInchesToTwip, SectionType,
  TableOfContents, StyleLevel, Footer, Header, PageNumber, NumberFormat,
  PageBreak, ExternalHyperlink, IRunOptions
} from "docx";
import {
  Stage, StageContext, QualityGateResult, DocumentPlan, SectionContent
} from "../contracts";

interface AssemblerInput {
  plan: DocumentPlan | undefined;
  sections: SectionContent[];
}

interface AssemblerOutput {
  artifact: {
    id: string;
    type: "docx";
    filename: string;
    mimeType: string;
    sizeBytes: number;
    buffer: Buffer;
  };
}

const HEADING_STYLES: Record<number, HeadingLevel> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
};

export class WordAssemblerStage implements Stage<AssemblerInput, AssemblerOutput> {
  id = "assembler";
  name = "Word Assembler (OpenXML)";

  async execute(input: AssemblerInput, context: StageContext): Promise<AssemblerOutput> {
    if (!input.plan || input.sections.length === 0) {
      throw new Error("No plan or sections to assemble");
    }

    context.emitEvent({
      eventType: "stage.progress",
      stageId: this.id,
      stageName: this.name,
      progress: 0.1,
      message: "Creating document structure",
    });

    const children: (Paragraph | Table | TableOfContents)[] = [];

    children.push(...this.createTitlePage(input.plan));

    context.emitEvent({
      eventType: "stage.progress",
      stageId: this.id,
      stageName: this.name,
      progress: 0.2,
      message: "Adding table of contents",
    });

    children.push(this.createTableOfContents());
    children.push(new Paragraph({ children: [], pageBreakBefore: true }));

    context.emitEvent({
      eventType: "stage.progress",
      stageId: this.id,
      stageName: this.name,
      progress: 0.4,
      message: "Rendering sections",
    });

    for (let i = 0; i < input.sections.length; i++) {
      const section = input.sections[i];
      const sectionSpec = input.plan.sections.find(s => s.id === section.sectionId);
      
      context.emitEvent({
        eventType: "stage.progress",
        stageId: this.id,
        stageName: this.name,
        progress: 0.4 + (0.5 * (i + 1) / input.sections.length),
        message: `Rendering: ${sectionSpec?.title || "Section"}`,
      });

      const sectionElements = this.renderSection(section, sectionSpec?.level || 1);
      children.push(...sectionElements);
    }

    const doc = new Document({
      styles: this.getDocumentStyles(input.plan),
      sections: [{
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(input.plan.style.margins?.top || 1),
              bottom: convertInchesToTwip(input.plan.style.margins?.bottom || 1),
              left: convertInchesToTwip(input.plan.style.margins?.left || 1),
              right: convertInchesToTwip(input.plan.style.margins?.right || 1),
            },
          },
        },
        headers: {
          default: new Header({
            children: [new Paragraph({
              children: [new TextRun({ text: input.plan.title, italics: true, size: 18 })],
              alignment: AlignmentType.RIGHT,
            })],
          }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              children: [
                new TextRun({ text: "Página ", size: 18 }),
                new TextRun({ children: [PageNumber.CURRENT], size: 18 }),
                new TextRun({ text: " de ", size: 18 }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18 }),
              ],
              alignment: AlignmentType.CENTER,
            })],
          }),
        },
        children,
      }],
      features: {
        updateFields: true,
      },
    });

    context.emitEvent({
      eventType: "stage.progress",
      stageId: this.id,
      stageName: this.name,
      progress: 0.95,
      message: "Generating DOCX buffer",
    });

    const buffer = await Packer.toBuffer(doc);

    const artifact = {
      id: uuidv4(),
      type: "docx" as const,
      filename: `${this.sanitizeFilename(input.plan.title)}_${Date.now()}.docx`,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: buffer.length,
      buffer: Buffer.from(buffer),
    };

    context.emitEvent({
      eventType: "artifact.created",
      data: { filename: artifact.filename, sizeBytes: artifact.sizeBytes },
    });

    return { artifact };
  }

  private createTitlePage(plan: DocumentPlan): Paragraph[] {
    return [
      new Paragraph({ children: [], spacing: { before: 2000 } }),
      new Paragraph({
        children: [new TextRun({ text: plan.title, bold: true, size: 56, font: plan.style.fontFamily })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      }),
      ...(plan.subtitle ? [new Paragraph({
        children: [new TextRun({ text: plan.subtitle, italics: true, size: 32, font: plan.style.fontFamily })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 800 },
      })] : []),
      new Paragraph({ children: [], spacing: { before: 1000 } }),
      new Paragraph({
        children: [new TextRun({ text: plan.authors.join(", "), size: 24, font: plan.style.fontFamily })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      }),
      new Paragraph({
        children: [new TextRun({ text: plan.date, size: 22, font: plan.style.fontFamily })],
        alignment: AlignmentType.CENTER,
      }),
      new Paragraph({ children: [], pageBreakBefore: true }),
    ];
  }

  private createTableOfContents(): TableOfContents {
    return new TableOfContents("Tabla de Contenidos", {
      hyperlink: true,
      headingStyleRange: "1-4",
      stylesWithLevels: [
        new StyleLevel("Heading1", 1),
        new StyleLevel("Heading2", 2),
        new StyleLevel("Heading3", 3),
        new StyleLevel("Heading4", 4),
      ],
    });
  }

  private renderSection(section: SectionContent, level: number): (Paragraph | Table)[] {
    const elements: (Paragraph | Table)[] = [];
    const lines = section.markdown.split("\n");
    
    let inList = false;
    let listItems: string[] = [];
    let inTable = false;
    let tableRows: string[][] = [];

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        if (inList) {
          elements.push(...this.renderList(listItems));
          listItems = [];
          inList = false;
        }
        if (inTable) {
          elements.push(this.renderTable(tableRows));
          tableRows = [];
          inTable = false;
        }

        const headingLevel = Math.min(headingMatch[1].length, 4);
        elements.push(new Paragraph({
          heading: HEADING_STYLES[headingLevel],
          children: [new TextRun({ text: headingMatch[2], bold: true })],
          spacing: { before: 240, after: 120 },
        }));
        continue;
      }

      if (line.match(/^\s*[-*]\s+/)) {
        inList = true;
        listItems.push(line.replace(/^\s*[-*]\s+/, ""));
        continue;
      } else if (inList) {
        elements.push(...this.renderList(listItems));
        listItems = [];
        inList = false;
      }

      if (line.includes("|") && line.trim().startsWith("|")) {
        if (line.match(/^\s*\|[\s-:|]+\|$/)) continue;
        
        inTable = true;
        const cells = line.split("|").filter(c => c.trim()).map(c => c.trim());
        tableRows.push(cells);
        continue;
      } else if (inTable) {
        elements.push(this.renderTable(tableRows));
        tableRows = [];
        inTable = false;
      }

      if (line.trim()) {
        const runs = this.parseInlineFormatting(line);
        elements.push(new Paragraph({
          children: runs,
          spacing: { after: 120, line: 276 },
        }));
      }
    }

    if (inList) {
      elements.push(...this.renderList(listItems));
    }
    if (inTable && tableRows.length > 0) {
      elements.push(this.renderTable(tableRows));
    }

    return elements;
  }

  private parseInlineFormatting(text: string): TextRun[] {
    const runs: TextRun[] = [];
    let remaining = text;

    const patterns = [
      { regex: /\*\*(.+?)\*\*/g, style: { bold: true } },
      { regex: /\*(.+?)\*/g, style: { italics: true } },
      { regex: /`(.+?)`/g, style: { font: "Consolas" } },
      { regex: /\[(\d+)\]/g, style: { superScript: true } },
    ];

    while (remaining.length > 0) {
      let earliestMatch: { index: number; length: number; text: string; style: Partial<IRunOptions> } | null = null;

      for (const pattern of patterns) {
        pattern.regex.lastIndex = 0;
        const match = pattern.regex.exec(remaining);
        if (match && (!earliestMatch || match.index < earliestMatch.index)) {
          earliestMatch = {
            index: match.index,
            length: match[0].length,
            text: match[1],
            style: pattern.style,
          };
        }
      }

      if (earliestMatch) {
        if (earliestMatch.index > 0) {
          runs.push(new TextRun({ text: remaining.slice(0, earliestMatch.index) }));
        }
        runs.push(new TextRun({ text: earliestMatch.text, ...earliestMatch.style }));
        remaining = remaining.slice(earliestMatch.index + earliestMatch.length);
      } else {
        runs.push(new TextRun({ text: remaining }));
        break;
      }
    }

    return runs;
  }

  private renderList(items: string[]): Paragraph[] {
    return items.map((item, index) => new Paragraph({
      children: [
        new TextRun({ text: `• ${item}` }),
      ],
      indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) },
      spacing: { after: 80 },
    }));
  }

  private renderTable(rows: string[][]): Table {
    const maxCols = Math.max(...rows.map(r => r.length));
    
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: rows.map((row, rowIndex) => new TableRow({
        children: Array.from({ length: maxCols }, (_, colIndex) => new TableCell({
          children: [new Paragraph({
            children: [new TextRun({
              text: row[colIndex] || "",
              bold: rowIndex === 0,
            })],
          })],
          shading: rowIndex === 0 ? { fill: "E7E6E6" } : undefined,
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
            left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
            right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
          },
        })),
      })),
    });
  }

  private getDocumentStyles(plan: DocumentPlan) {
    const baseFontSize = (plan.style.fontSize || 11) * 2;
    
    return {
      default: {
        document: {
          run: {
            font: plan.style.fontFamily,
            size: baseFontSize,
          },
          paragraph: {
            spacing: { line: Math.round((plan.style.lineSpacing || 1.15) * 240) },
          },
        },
      },
      paragraphStyles: [
        {
          id: "Normal",
          name: "Normal",
          basedOn: "Normal",
          next: "Normal",
          run: { font: plan.style.fontFamily, size: baseFontSize },
          paragraph: { spacing: { line: Math.round((plan.style.lineSpacing || 1.15) * 240) } },
        },
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          run: { font: plan.style.fontFamily, size: baseFontSize + 8, bold: true, color: "2F5496" },
          paragraph: { spacing: { before: 240, after: 120 } },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          run: { font: plan.style.fontFamily, size: baseFontSize + 4, bold: true, color: "2F5496" },
          paragraph: { spacing: { before: 200, after: 100 } },
        },
        {
          id: "Heading3",
          name: "Heading 3",
          basedOn: "Normal",
          next: "Normal",
          run: { font: plan.style.fontFamily, size: baseFontSize + 2, bold: true },
          paragraph: { spacing: { before: 160, after: 80 } },
        },
      ],
    };
  }

  private sanitizeFilename(title: string): string {
    return title
      .replace(/[<>:"/\\|?*]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 50);
  }

  validate(output: AssemblerOutput): QualityGateResult {
    const issues: QualityGateResult["issues"] = [];
    let score = 1.0;

    if (!output.artifact?.buffer) {
      issues.push({ severity: "error", message: "No document buffer generated" });
      score = 0;
    } else if (output.artifact.sizeBytes < 1000) {
      issues.push({ severity: "warning", message: "Document size is unusually small" });
      score -= 0.2;
    }

    return {
      gateId: "assembler_quality",
      gateName: "Document Assembly Quality",
      passed: score >= 0.7,
      score: Math.max(0, score),
      threshold: 0.7,
      issues,
      checkedAt: new Date().toISOString(),
    };
  }

  async fallback(input: AssemblerInput, context: StageContext): Promise<AssemblerOutput> {
    const simpleDoc = new Document({
      sections: [{
        children: [
          new Paragraph({
            children: [new TextRun({ text: input.plan?.title || "Document", bold: true, size: 32 })],
          }),
          ...input.sections.map(s => new Paragraph({
            children: [new TextRun({ text: s.markdown.slice(0, 1000) })],
          })),
        ],
      }],
    });

    const buffer = await Packer.toBuffer(simpleDoc);

    return {
      artifact: {
        id: uuidv4(),
        type: "docx",
        filename: `document_${Date.now()}.docx`,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: buffer.length,
        buffer: Buffer.from(buffer),
      },
    };
  }
}

export const wordAssemblerStage = new WordAssemblerStage();
