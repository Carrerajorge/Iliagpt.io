import type { DocSpec, DocBlock } from '@shared/documentSpecs';

interface TipTapNode {
  type: string;
  content?: TipTapNode[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

interface TipTapDoc {
  type: 'doc';
  content: TipTapNode[];
}

export function tiptapToDocSpec(doc: TipTapDoc, title = 'Document'): DocSpec {
  const blocks: DocBlock[] = [];
  
  for (const node of doc.content || []) {
    const converted = convertNode(node);
    if (converted) {
      if (Array.isArray(converted)) {
        blocks.push(...converted);
      } else {
        blocks.push(converted);
      }
    }
  }

  return {
    title,
    styleset: 'modern',
    blocks,
    add_toc: false,
  };
}

function convertNode(node: TipTapNode): DocBlock | DocBlock[] | null {
  switch (node.type) {
    case 'heading':
      return {
        type: 'heading',
        level: (node.attrs?.level as number) || 1,
        text: extractText(node),
      };

    case 'paragraph':
      const text = extractText(node);
      if (!text.trim()) return null;
      return {
        type: 'paragraph',
        text,
      };

    case 'bulletList':
      return {
        type: 'bullets',
        items: (node.content || [])
          .filter((item) => item.type === 'listItem')
          .map((item) => extractText(item)),
      };

    case 'orderedList':
      return {
        type: 'bullets',
        items: (node.content || [])
          .filter((item) => item.type === 'listItem')
          .map((item, idx) => `${idx + 1}. ${extractText(item)}`),
      };

    case 'table':
      return convertTable(node);

    case 'blockquote':
      return {
        type: 'paragraph',
        text: `> ${extractText(node)}`,
      };

    case 'codeBlock':
      return {
        type: 'paragraph',
        text: `\`\`\`\n${extractText(node)}\n\`\`\``,
      };

    case 'horizontalRule':
      return {
        type: 'page_break',
      };

    default:
      return null;
  }
}

function extractText(node: TipTapNode): string {
  // Handle math nodes from @aarkue/tiptap-math-extension
  // The extension uses 'inlineMath' as the node type name
  if (node.type === 'inlineMath' || node.type === 'math' || node.type === 'mathInline' || node.type === 'mathBlock') {
    const latex = node.attrs?.latex as string || '';
    const isBlock = node.type === 'mathBlock' || node.attrs?.display === 'yes';
    return isBlock ? `$$${latex}$$` : `$${latex}$`;
  }

  if (node.text) {
    let text = node.text;
    if (node.marks) {
      for (const mark of node.marks) {
        switch (mark.type) {
          case 'bold':
            text = `**${text}**`;
            break;
          case 'italic':
            text = `*${text}*`;
            break;
          case 'underline':
            text = `_${text}_`;
            break;
          case 'strike':
            text = `~~${text}~~`;
            break;
          case 'link':
            text = `[${text}](${mark.attrs?.href || ''})`;
            break;
        }
      }
    }
    return text;
  }

  if (!node.content) return '';

  return node.content.map(extractText).join('');
}

function convertTable(node: TipTapNode): DocBlock | null {
  if (!node.content) return null;

  const rows = node.content.filter((row) => row.type === 'tableRow');
  if (rows.length === 0) return null;

  const columns: string[] = [];
  const dataRows: string[][] = [];

  rows.forEach((row, rowIndex) => {
    const cells = row.content || [];
    const rowData: string[] = [];

    cells.forEach((cell) => {
      const text = extractText(cell);
      if (rowIndex === 0 && cell.type === 'tableHeader') {
        columns.push(text);
      } else {
        rowData.push(text);
      }
    });

    if (rowIndex > 0 || columns.length === 0) {
      if (rowIndex === 0 && columns.length === 0) {
        cells.forEach((cell) => columns.push(extractText(cell)));
      } else if (rowData.length > 0) {
        dataRows.push(rowData);
      }
    }
  });

  if (columns.length === 0) return null;

  return {
    type: 'table',
    columns,
    rows: dataRows,
    style: 'Light Shading',
    header: true,
  };
}

export async function exportToWord(doc: TipTapDoc, title = 'Document'): Promise<Blob> {
  const spec = tiptapToDocSpec(doc, title);
  
  const response = await fetch('/api/documents/render/word', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(spec),
  });

  if (!response.ok) {
    throw new Error('Failed to generate Word document');
  }

  return response.blob();
}
