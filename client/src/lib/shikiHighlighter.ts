import type { Highlighter, BundledLanguage, BundledTheme } from 'shiki';

const languageAliases: Record<string, string> = {
  'js': 'javascript',
  'ts': 'typescript',
  'py': 'python',
  'rb': 'ruby',
  'yml': 'yaml',
  'sh': 'bash',
  'shell': 'bash',
  'zsh': 'bash',
  'dockerfile': 'docker',
  'md': 'markdown',
  'htm': 'html',
  'jsonc': 'json',
  'tsx': 'tsx',
  'jsx': 'jsx',
  'c++': 'cpp',
  'c#': 'csharp',
  'cs': 'csharp',
  'golang': 'go',
  'rs': 'rust',
  'kt': 'kotlin',
  'plaintext': 'text',
  'txt': 'text',
};

const INITIAL_LANGUAGES: BundledLanguage[] = [
  'javascript', 'typescript', 'python', 'bash', 'json', 'html', 'css',
  'jsx', 'tsx', 'sql', 'markdown', 'yaml', 'go', 'rust', 'java',
  'c', 'cpp', 'csharp', 'php', 'ruby', 'swift', 'kotlin',
];

const DARK_THEME: BundledTheme = 'one-dark-pro';
const LIGHT_THEME: BundledTheme = 'github-light';

let highlighterInstance: Highlighter | null = null;
let highlighterPromise: Promise<Highlighter> | null = null;
const loadedLanguages = new Set<string>(INITIAL_LANGUAGES as string[]);

function resolveLanguage(lang: string): string {
  const normalized = lang.toLowerCase().trim();
  return languageAliases[normalized] || normalized;
}

export async function getHighlighter(): Promise<Highlighter> {
  if (highlighterInstance) return highlighterInstance;

  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const { createHighlighter } = await import('shiki');
      const instance = await createHighlighter({
        themes: [DARK_THEME, LIGHT_THEME],
        langs: INITIAL_LANGUAGES,
      });
      highlighterInstance = instance;
      return instance;
    })();
  }

  return highlighterPromise;
}

async function ensureLanguageLoaded(highlighter: Highlighter, lang: string): Promise<boolean> {
  if (loadedLanguages.has(lang)) return true;

  try {
    await highlighter.loadLanguage(lang as BundledLanguage);
    loadedLanguages.add(lang);
    return true;
  } catch (error) {
    console.warn(`[shikiHighlighter] Failed to load language: ${lang}`, error);
    return false;
  }
}

export async function highlightCode(
  code: string,
  lang: string,
  theme?: 'dark' | 'light'
): Promise<string> {
  const resolved = resolveLanguage(lang);

  if (resolved === 'text' || resolved === 'plaintext' || !code) {
    return escapeHtml(code);
  }

  try {
    const highlighter = await getHighlighter();
    const loaded = await ensureLanguageLoaded(highlighter, resolved);

    if (!loaded) {
      return escapeHtml(code);
    }

    const selectedTheme = theme === 'light' ? LIGHT_THEME : DARK_THEME;

    const html = highlighter.codeToHtml(code, {
      lang: resolved,
      theme: selectedTheme,
    });

    return html;
  } catch (error) {
    console.warn(`[shikiHighlighter] Error highlighting code (lang: ${resolved}):`, error);
    return escapeHtml(code);
  }
}

export function resolveLanguageAlias(lang: string): string {
  return resolveLanguage(lang);
}

function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => htmlEscapes[char] || char);
}
