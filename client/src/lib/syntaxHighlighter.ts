import Prism from 'prismjs';
import 'prismjs/components/prism-core';

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
  'tf': 'hcl',
  'terraform': 'hcl',
  'plaintext': 'text',
  'txt': 'text',
};

const loadedLanguages = new Set<string>(['javascript', 'css', 'markup', 'clike']);
const loadingPromises = new Map<string, Promise<void>>();

const languageDependencies: Record<string, string[]> = {
  'typescript': ['javascript'],
  'jsx': ['javascript'],
  'tsx': ['javascript', 'jsx', 'typescript'],
  'cpp': ['c'],
  'csharp': ['clike'],
  'java': ['clike'],
  'kotlin': ['clike'],
  'scala': ['java'],
  'swift': ['clike'],
  'objectivec': ['c'],
  'php': ['markup', 'clike'],
  'aspnet': ['markup', 'csharp'],
  'scss': ['css'],
  'sass': ['css'],
  'less': ['css'],
  'stylus': ['css'],
  'pug': ['markup', 'javascript'],
  'markdown': ['markup'],
  'django': ['markup', 'python'],
  'erb': ['markup', 'ruby'],
  'handlebars': ['markup'],
  'twig': ['markup'],
  'velocity': ['markup'],
};

const supportedLanguages = [
  'javascript', 'typescript', 'python', 'java', 'c', 'cpp', 'csharp',
  'go', 'rust', 'ruby', 'php', 'swift', 'kotlin', 'scala',
  'html', 'css', 'scss', 'sass', 'less',
  'json', 'yaml', 'xml', 'markdown',
  'sql', 'graphql', 'bash', 'powershell',
  'docker', 'nginx', 'apache',
  'jsx', 'tsx', 'vue',
  'perl', 'r', 'matlab', 'julia',
  'haskell', 'elixir', 'erlang', 'clojure', 'lisp',
  'lua', 'dart', 'objectivec',
  'makefile', 'cmake', 'hcl',
  'diff', 'git', 'ini', 'toml',
  'regex', 'latex', 'text',
];

function resolveLanguage(lang: string): string {
  const normalized = lang.toLowerCase().trim();
  return languageAliases[normalized] || normalized;
}

async function loadLanguageDependencies(lang: string): Promise<void> {
  const deps = languageDependencies[lang];
  if (deps) {
    for (const dep of deps) {
      await loadLanguage(dep);
    }
  }
}

export async function loadLanguage(lang: string): Promise<boolean> {
  const resolved = resolveLanguage(lang);
  
  if (resolved === 'text' || resolved === 'plaintext') {
    return true;
  }
  
  if (loadedLanguages.has(resolved)) {
    return true;
  }
  
  if (loadingPromises.has(resolved)) {
    await loadingPromises.get(resolved);
    return loadedLanguages.has(resolved);
  }
  
  const loadPromise = (async () => {
    try {
      await loadLanguageDependencies(resolved);
      
      const langModule = await import(/* @vite-ignore */ `prismjs/components/prism-${resolved}.js`);
      
      if (langModule) {
        loadedLanguages.add(resolved);
      }
    } catch (error) {
      console.warn(`Failed to load Prism language: ${resolved}`, error);
    } finally {
      loadingPromises.delete(resolved);
    }
  })();
  
  loadingPromises.set(resolved, loadPromise);
  await loadPromise;
  
  return loadedLanguages.has(resolved);
}

export function highlightCode(code: string, language: string): string {
  const resolved = resolveLanguage(language);
  
  if (resolved === 'text' || resolved === 'plaintext' || !code) {
    return escapeHtml(code);
  }
  
  const grammar = Prism.languages[resolved];
  
  if (!grammar) {
    return escapeHtml(code);
  }
  
  try {
    return Prism.highlight(code, grammar, resolved);
  } catch (error) {
    console.warn(`Error highlighting code with language: ${resolved}`, error);
    return escapeHtml(code);
  }
}

export async function highlightCodeAsync(code: string, language: string): Promise<string> {
  const resolved = resolveLanguage(language);
  
  if (resolved === 'text' || resolved === 'plaintext' || !code) {
    return escapeHtml(code);
  }
  
  await loadLanguage(resolved);
  return highlightCode(code, resolved);
}

export function getSupportedLanguages(): string[] {
  return [...supportedLanguages];
}

export function getLoadedLanguages(): string[] {
  return [...loadedLanguages];
}

export function isLanguageLoaded(lang: string): boolean {
  const resolved = resolveLanguage(lang);
  return loadedLanguages.has(resolved) || resolved === 'text' || resolved === 'plaintext';
}

export function getLanguageAlias(lang: string): string {
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

export { Prism };
