export type DocumentFormat = "markdown" | "rst" | "auto";

export interface ParsedDocument {
  format: "markdown" | "rst";
  html: string;
  toc?: TableOfContentsItem[];
}

export interface TableOfContentsItem {
  level: number;
  title: string;
  id: string;
}

export function detectFormat(content: string, filename?: string): "markdown" | "rst" {
  if (filename) {
    const ext = filename.toLowerCase().split('.').pop();
    if (ext === 'rst' || ext === 'rest') return "rst";
    if (ext === 'md' || ext === 'markdown' || ext === 'mdx') return "markdown";
  }
  const rstPatterns = [
    /^[=\-~`'"^_*+#]+\s*$/m,
    /^\.\.\s+\w+::/m,
    /^:\w+:/m,
    /^\s*\.\.\s+_\w+:/m,
    /^```.+```$/m,
  ];

  const markdownPatterns = [
    /^#{1,6}\s+/m,
    /^\*{3,}$|^-{3,}$|^_{3,}$/m,
    /\[.+\]\(.+\)/,
    /^>\s+/m,
    /^```\w*$/m,
  ];

  let rstScore = 0;
  let mdScore = 0;

  for (const pattern of rstPatterns) {
    if (pattern.test(content)) rstScore++;
  }

  for (const pattern of markdownPatterns) {
    if (pattern.test(content)) mdScore++;
  }

  return rstScore > mdScore ? "rst" : "markdown";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function generateId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 50);
}

export function parseRst(content: string): ParsedDocument {
  if (!content) {
    return { format: "rst", html: "" };
  }

  const lines = content.split('\n');
  const htmlParts: string[] = [];
  const toc: TableOfContentsItem[] = [];
  let i = 0;
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let codeBlockLang = '';
  let inBlockquote = false;
  let blockquoteContent: string[] = [];
  let inList = false;
  let listItems: string[] = [];
  let listType: 'ul' | 'ol' = 'ul';

  const flushCodeBlock = () => {
    if (codeBlockContent.length > 0) {
      const code = escapeHtml(codeBlockContent.join('\n'));
      const langClass = codeBlockLang ? ` class="language-${codeBlockLang}"` : '';
      htmlParts.push(`<pre><code${langClass}>${code}</code></pre>`);
      codeBlockContent = [];
      codeBlockLang = '';
    }
    inCodeBlock = false;
  };

  const flushBlockquote = () => {
    if (blockquoteContent.length > 0) {
      htmlParts.push(`<blockquote>${blockquoteContent.join('<br>')}</blockquote>`);
      blockquoteContent = [];
    }
    inBlockquote = false;
  };

  const flushList = () => {
    if (listItems.length > 0) {
      const items = listItems.map(item => `<li>${item}</li>`).join('');
      htmlParts.push(`<${listType}>${items}</${listType}>`);
      listItems = [];
    }
    inList = false;
  };

  while (i < lines.length) {
    const line = lines[i];
    const nextLine = lines[i + 1] || '';
    if (inCodeBlock) {
      if (line.match(/^\s{0,2}\S/) && !line.startsWith('   ')) {
        flushCodeBlock();
        continue;
      }
      codeBlockContent.push(line.replace(/^   /, ''));
      i++;
      continue;
    }
    const codeBlockMatch = line.match(/^\.\.\s+code-block::\s*(\w+)?/i) || 
                           line.match(/^\.\.\s+code::\s*(\w+)?/i) ||
                           line.match(/^::\s*$/);
    if (codeBlockMatch) {
      flushBlockquote();
      flushList();
      codeBlockLang = codeBlockMatch[1] || '';
      inCodeBlock = true;
      i++;
      while (i < lines.length && lines[i].trim() === '') i++;
      continue;
    }
    if (line.trim() === '' && nextLine.match(/^\s{3,}/)) {
      flushBlockquote();
      flushList();
      inCodeBlock = true;
      i++;
      continue;
    }
    const titleUnderlineMatch = nextLine.match(/^([=\-~`'"^_*+#])\1{2,}\s*$/);
    if (titleUnderlineMatch && line.trim().length > 0 && !line.startsWith(' ')) {
      flushBlockquote();
      flushList();
      const char = titleUnderlineMatch[1];
      const levelMap: Record<string, number> = { '=': 1, '-': 2, '~': 3, '^': 4, '"': 5, "'": 6 };
      const level = levelMap[char] || 2;
      const title = line.trim();
      const id = generateId(title);
      toc.push({ level, title, id });
      htmlParts.push(`<h${level} id="${id}">${escapeHtml(title)}</h${level}>`);
      i += 2;
      continue;
    }
    const noteMatch = line.match(/^\.\.\s+(note|warning|tip|important|caution|danger|attention|error|hint)::\s*(.*)$/i);
    if (noteMatch) {
      flushBlockquote();
      flushList();
      const type = noteMatch[1].toLowerCase();
      const title = noteMatch[2] || type.charAt(0).toUpperCase() + type.slice(1);
      let noteContent: string[] = [];
      i++;
      while (i < lines.length && (lines[i].startsWith('   ') || lines[i].trim() === '')) {
        if (lines[i].trim()) noteContent.push(lines[i].replace(/^\s{3}/, ''));
        i++;
      }
      htmlParts.push(`<div class="admonition ${type}"><p class="admonition-title">${escapeHtml(title)}</p><p>${escapeHtml(noteContent.join(' '))}</p></div>`);
      continue;
    }
    const imageMatch = line.match(/^\.\.\s+image::\s*(.+)$/);
    if (imageMatch) {
      flushBlockquote();
      flushList();
      const src = imageMatch[1].trim();
      let alt = '';
      i++;
      while (i < lines.length && lines[i].startsWith('   :')) {
        const attrMatch = lines[i].match(/^\s+:(\w+):\s*(.*)$/);
        if (attrMatch && attrMatch[1] === 'alt') {
          alt = attrMatch[2];
        }
        i++;
      }
      htmlParts.push(`<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" />`);
      continue;
    }
    const linkTargetMatch = line.match(/^\.\.\s+_([^:]+):\s*(.+)$/);
    if (linkTargetMatch) {
      i++;
      continue;
    }
    const bulletMatch = line.match(/^(\*|-|\+)\s+(.+)$/);
    if (bulletMatch) {
      flushBlockquote();
      if (!inList || listType !== 'ul') {
        flushList();
        inList = true;
        listType = 'ul';
      }
      listItems.push(escapeHtml(bulletMatch[2]));
      i++;
      continue;
    }
    const numberedMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (numberedMatch) {
      flushBlockquote();
      if (!inList || listType !== 'ol') {
        flushList();
        inList = true;
        listType = 'ol';
      }
      listItems.push(escapeHtml(numberedMatch[2]));
      i++;
      continue;
    }
    if (line.trim() === '') {
      flushBlockquote();
      flushList();
      i++;
      continue;
    }
    let processed = escapeHtml(line);
    processed = processed.replace(/``([^`]+)``/g, (_, content) => `<code>${content}</code>`);
    processed = processed.replace(/`([^`]+)`_/g, (_, content) => `<a href="#">${content}</a>`);
    processed = processed.replace(/\*\*([^*]+)\*\*/g, (_, content) => `<strong>${content}</strong>`);
    processed = processed.replace(/\*([^*]+)\*/g, (_, content) => `<em>${content}</em>`);
    processed = processed.replace(/:(\w+):`([^`]+)`/g, (_, role, content) => `<span class="role-${role}">${content}</span>`);

    if (inList) {
      listItems[listItems.length - 1] += ' ' + processed;
    } else {
      htmlParts.push(`<p>${processed}</p>`);
    }
    i++;
  }

  flushCodeBlock();
  flushBlockquote();
  flushList();

  return {
    format: "rst",
    html: htmlParts.join('\n'),
    toc: toc.length > 0 ? toc : undefined,
  };
}

export function parseDocument(
  content: string, 
  format: DocumentFormat = "auto",
  filename?: string
): ParsedDocument {
  const detectedFormat = format === "auto" ? detectFormat(content, filename) : format;
  
  if (detectedFormat === "rst") {
    return parseRst(content);
  }
  return {
    format: "markdown",
    html: content,
  };
}
