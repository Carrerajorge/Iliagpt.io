import Prism from 'prismjs';
import 'prismjs/components/prism-core';

const loadedLanguages = new Set<string>(['javascript', 'css', 'markup', 'clike']);
const loadingPromises = new Map<string, Promise<void>>();

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

function resolveLanguage(lang: string): string {
  const normalized = lang.toLowerCase().trim();
  return languageAliases[normalized] || normalized;
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

async function loadLanguageDependencies(lang: string): Promise<void> {
  const deps = languageDependencies[lang];
  if (deps) {
    for (const dep of deps) {
      await loadLanguageInWorker(dep);
    }
  }
}

async function loadLanguageInWorker(lang: string): Promise<boolean> {
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
      
      const langModule = await import(`prismjs/components/prism-${resolved}.js`);
      
      if (langModule) {
        loadedLanguages.add(resolved);
      }
    } catch (error) {
      console.warn(`[PrismWorker] Failed to load language: ${resolved}`, error);
    } finally {
      loadingPromises.delete(resolved);
    }
  })();
  
  loadingPromises.set(resolved, loadPromise);
  await loadPromise;
  
  return loadedLanguages.has(resolved);
}

function highlightCodeSync(code: string, language: string): string {
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
    console.warn(`[PrismWorker] Error highlighting: ${resolved}`, error);
    return escapeHtml(code);
  }
}

export interface PrismWorkerRequest {
  id: string;
  code: string;
  language: string;
}

export interface PrismWorkerResponse {
  id: string;
  html: string;
  language: string;
  success: boolean;
  error?: string;
}

self.onmessage = async (event: MessageEvent<PrismWorkerRequest>) => {
  const { id, code, language } = event.data;
  
  try {
    const resolved = resolveLanguage(language);
    
    await loadLanguageInWorker(resolved);
    
    const html = highlightCodeSync(code, resolved);
    
    const response: PrismWorkerResponse = {
      id,
      html,
      language: resolved,
      success: true,
    };
    
    self.postMessage(response);
  } catch (error) {
    const response: PrismWorkerResponse = {
      id,
      html: escapeHtml(code),
      language: resolveLanguage(language),
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
    
    self.postMessage(response);
  }
};

export {};
