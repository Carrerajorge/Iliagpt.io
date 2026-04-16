import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  ExternalHyperlink,
  TableOfContents,
  PageBreak,
  Header,
  Footer,
  PageNumber,
  NumberFormat,
} from "docx";
import { ScientificArticle, generateAPA7Citation } from "@shared/scientificArticleSchema";

export class ScientificWordGenerator {
  async generateWord(
    articles: ScientificArticle[],
    query: string,
    includeAbstracts: boolean = true
  ): Promise<Buffer> {
    const sortedArticles = [...articles].sort((a, b) => {
      const authorA = a.authors[0]?.lastName || "";
      const authorB = b.authors[0]?.lastName || "";
      return authorA.localeCompare(authorB);
    });

    const sections = [];

    sections.push(this.createTitleSection(query, articles.length));
    
    if (includeAbstracts) {
      sections.push(...this.createArticleSummaries(sortedArticles));
    }
    
    sections.push(this.createBibliographySection(sortedArticles));

    const doc = new Document({
      creator: "IliaGPT",
      title: `Búsqueda Científica: ${query}`,
      description: `Informe de búsqueda científica generado por IliaGPT`,
      styles: {
        paragraphStyles: [
          {
            id: "Normal",
            name: "Normal",
            basedOn: "Normal",
            next: "Normal",
            run: {
              font: "Times New Roman",
              size: 24,
            },
            paragraph: {
              spacing: { line: 480, after: 200 },
            },
          },
          {
            id: "Heading1",
            name: "Heading 1",
            basedOn: "Normal",
            next: "Normal",
            run: {
              font: "Times New Roman",
              size: 28,
              bold: true,
            },
            paragraph: {
              spacing: { before: 240, after: 120 },
            },
          },
          {
            id: "Heading2",
            name: "Heading 2",
            basedOn: "Normal",
            next: "Normal",
            run: {
              font: "Times New Roman",
              size: 26,
              bold: true,
            },
            paragraph: {
              spacing: { before: 200, after: 100 },
            },
          },
          {
            id: "Bibliography",
            name: "Bibliography",
            basedOn: "Normal",
            run: {
              font: "Times New Roman",
              size: 24,
            },
            paragraph: {
              spacing: { line: 480, after: 200 },
              indent: { hanging: 720 },
            },
          },
        ],
      },
      sections: [
        {
          properties: {},
          headers: {
            default: new Header({
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({
                      text: `Búsqueda: ${query.slice(0, 50)}${query.length > 50 ? "..." : ""}`,
                      font: "Times New Roman",
                      size: 20,
                    }),
                  ],
                }),
              ],
            }),
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      children: [PageNumber.CURRENT],
                      font: "Times New Roman",
                      size: 20,
                    }),
                  ],
                }),
              ],
            }),
          },
          children: sections.flat(),
        },
      ],
    });

    const Packer = (await import("docx")).Packer;
    const buffer = await Packer.toBuffer(doc);
    return buffer;
  }

  private createTitleSection(query: string, totalArticles: number): Paragraph[] {
    const today = new Date().toLocaleDateString("es-ES", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    return [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 1200, after: 400 },
        children: [
          new TextRun({
            text: "INFORME DE BÚSQUEDA CIENTÍFICA",
            bold: true,
            font: "Times New Roman",
            size: 32,
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [
          new TextRun({
            text: `Tema: ${query}`,
            font: "Times New Roman",
            size: 28,
            italics: true,
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [
          new TextRun({
            text: `Fecha de generación: ${today}`,
            font: "Times New Roman",
            size: 24,
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
        children: [
          new TextRun({
            text: `Total de artículos encontrados: ${totalArticles}`,
            font: "Times New Roman",
            size: 24,
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 800 },
        children: [
          new TextRun({
            text: "Generado por IliaGPT - Asistente de Investigación Científica",
            font: "Times New Roman",
            size: 20,
            italics: true,
          }),
        ],
      }),
      new Paragraph({
        children: [new PageBreak()],
      }),
    ];
  }

  private createArticleSummaries(articles: ScientificArticle[]): Paragraph[] {
    const paragraphs: Paragraph[] = [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [
          new TextRun({
            text: "Resumen de Artículos",
            bold: true,
            font: "Times New Roman",
            size: 28,
          }),
        ],
      }),
      new Paragraph({
        spacing: { after: 300 },
        children: [
          new TextRun({
            text: "A continuación se presenta un resumen de cada artículo encontrado en la búsqueda, incluyendo información bibliográfica y abstract cuando está disponible.",
            font: "Times New Roman",
            size: 24,
          }),
        ],
      }),
    ];

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 200 },
          children: [
            new TextRun({
              text: `${i + 1}. ${article.title}`,
              bold: true,
              font: "Times New Roman",
              size: 24,
            }),
          ],
        })
      );

      const metadata: string[] = [];
      if (article.authors.length > 0) {
        metadata.push(`Autores: ${article.authors.map(a => a.fullName).join(", ")}`);
      }
      if (article.journal?.title) {
        metadata.push(`Revista: ${article.journal.title}`);
      }
      if (article.year) {
        metadata.push(`Año: ${article.year}`);
      }
      if (article.doi) {
        metadata.push(`DOI: ${article.doi}`);
      }
      if (article.citationCount) {
        metadata.push(`Citaciones: ${article.citationCount}`);
      }

      paragraphs.push(
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({
              text: metadata.join(" | "),
              font: "Times New Roman",
              size: 22,
              italics: true,
            }),
          ],
        })
      );

      if (article.abstract) {
        paragraphs.push(
          new Paragraph({
            spacing: { after: 100 },
            children: [
              new TextRun({
                text: "Abstract: ",
                bold: true,
                font: "Times New Roman",
                size: 24,
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 300 },
            children: [
              new TextRun({
                text: article.abstract,
                font: "Times New Roman",
                size: 24,
              }),
            ],
          })
        );
      }

      if (article.keywords && article.keywords.length > 0) {
        paragraphs.push(
          new Paragraph({
            spacing: { after: 200 },
            children: [
              new TextRun({
                text: "Palabras clave: ",
                bold: true,
                font: "Times New Roman",
                size: 22,
              }),
              new TextRun({
                text: article.keywords.join(", "),
                font: "Times New Roman",
                size: 22,
                italics: true,
              }),
            ],
          })
        );
      }
    }

    paragraphs.push(
      new Paragraph({
        children: [new PageBreak()],
      })
    );

    return paragraphs;
  }

  private createBibliographySection(articles: ScientificArticle[]): Paragraph[] {
    const paragraphs: Paragraph[] = [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
        children: [
          new TextRun({
            text: "Referencias",
            bold: true,
            font: "Times New Roman",
            size: 28,
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 600 },
        children: [
          new TextRun({
            text: "(Formato APA 7ma Edición)",
            font: "Times New Roman",
            size: 24,
            italics: true,
          }),
        ],
      }),
    ];

    for (const article of articles) {
      const citation = generateAPA7Citation(article);
      
      paragraphs.push(
        new Paragraph({
          style: "Bibliography",
          spacing: { after: 240 },
          indent: { hanging: 720, left: 720 },
          children: [
            new TextRun({
              text: citation,
              font: "Times New Roman",
              size: 24,
            }),
          ],
        })
      );
    }

    return paragraphs;
  }
}

export const scientificWordGenerator = new ScientificWordGenerator();
