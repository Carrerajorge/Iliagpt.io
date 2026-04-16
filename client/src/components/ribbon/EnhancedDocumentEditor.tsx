import { useEffect, useCallback, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import FontFamily from '@tiptap/extension-font-family';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import MathExtension from '@aarkue/tiptap-math-extension';
import { RibbonShell } from './RibbonShell';
import { initializeDocumentAdapter, commandBus } from '@/lib/commands';
import { aiOrchestrator } from '@/lib/orchestrator';
import { exportToWord } from '@/lib/docSpecSerializer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Download, Sparkles, Loader2, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { markdownToTipTap } from '@/lib/markdownToHtml';
import { autoSaveToMediaLibrary } from '@/lib/mediaAutoSave';
import 'katex/dist/katex.min.css';

interface EnhancedDocumentEditorProps {
  title: string;
  content: string;
  onChange: (content: string) => void;
  onClose: () => void;
  onDownload: () => void;
  onSaveToLibrary?: () => void;
  onTextSelect?: (text: string, applyRewrite: (newText: string) => void) => void;
  onTextDeselect?: () => void;
  onInsertContent?: (insertFn: (content: string, replaceMode?: boolean | 'html') => void) => void;
}

export function EnhancedDocumentEditor({
  title,
  content,
  onChange,
  onClose,
  onDownload,
  onSaveToLibrary,
  onTextSelect,
  onTextDeselect,
  onInsertContent,
}: EnhancedDocumentEditorProps) {
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [showAiBar, setShowAiBar] = useState(false);
  const savedRangeRef = useRef<Range | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle,
      FontFamily,
      Color,
      Highlight.configure({ multicolor: true }),
      Link.configure({ openOnClick: false }),
      Image,
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      MathExtension.configure({
        evaluation: false,
        delimiters: 'dollar',
        katexOptions: { throwOnError: false, displayMode: false },
      }),
    ],
    content: markdownToTipTap(content),
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'prose prose-lg max-w-none focus:outline-none min-h-[800px] p-8',
      },
    },
  });

  useEffect(() => {
    if (editor) {
      initializeDocumentAdapter(editor);
    }
  }, [editor]);

  const applyRewrite = useCallback((newText: string) => {
    if (!editor || !savedRangeRef.current) return;
    const { from, to } = editor.state.selection;
    editor.chain().focus().deleteRange({ from, to }).insertContent(newText).run();
    savedRangeRef.current = null;
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) {
        // Check if selection is within the editor
        const editorElement = editor.view.dom;
        const selectionNode = selection.anchorNode;
        if (selectionNode && editorElement.contains(selectionNode)) {
          savedRangeRef.current = selection.getRangeAt(0).cloneRange();
          onTextSelect?.(selection.toString(), applyRewrite);
        }
      }
      // DON'T call onTextDeselect here - the chip should persist
      // until user explicitly removes it or sends the message
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [editor, onTextSelect, onTextDeselect, applyRewrite]);

  useEffect(() => {
    if (!editor || !onInsertContent) return;

    // insertFn modes:
    // - replaceMode = true: Replace with markdown content (converted to TipTap)
    // - replaceMode = false: Append markdown to end of document
    // - replaceMode = 'html': Replace with raw HTML content (for cumulative mode - HTML + separator + converted markdown)
    const insertFn = (text: string, replaceMode: boolean | 'html' = false) => {
      if (replaceMode === true) {
        editor.commands.setContent(markdownToTipTap(text));
      } else if (replaceMode === 'html') {
        // Set raw HTML content directly (used for cumulative mode)
        editor.commands.setContent(text);
      } else {
        // Append mode for streaming - just add content at cursor
        editor.chain().focus().insertContent(markdownToTipTap(text)).run();
      }
    };

    onInsertContent(insertFn);
  }, [editor, onInsertContent]);

  const handleAICommand = useCallback(async (action: string) => {
    if (action === 'open') {
      setShowAiBar(true);
      return;
    }

    if (!editor) return;

    setIsAiProcessing(true);
    try {
      const { from, to } = editor.state.selection;
      const selectedText = editor.state.doc.textBetween(from, to, ' ');

      const plan = await aiOrchestrator.planFromPrompt(action, {
        selectedText,
        documentContent: editor.getHTML(),
      });

      if (plan.commands.length > 0) {
        await aiOrchestrator.executePlan(plan);
      }
    } catch (error) {
      console.error('AI command failed:', error);
    } finally {
      setIsAiProcessing(false);
    }
  }, [editor]);

  const handleAIPromptSubmit = useCallback(async () => {
    if (!aiPrompt.trim() || !editor) return;

    setIsAiProcessing(true);
    try {
      const { from, to } = editor.state.selection;
      const selectedText = editor.state.doc.textBetween(from, to, ' ');

      const plan = await aiOrchestrator.planFromPrompt(aiPrompt, {
        selectedText,
        documentContent: editor.getHTML(),
      });

      if (plan.commands.length > 0) {
        await aiOrchestrator.executePlan(plan);
      }

      setAiPrompt('');
      setShowAiBar(false);
    } catch (error) {
      console.error('AI prompt failed:', error);
    } finally {
      setIsAiProcessing(false);
    }
  }, [aiPrompt, editor]);

  const handleExportWord = useCallback(async () => {
    if (!editor) return;

    try {
      const doc = editor.getJSON();
      const blob = await exportToWord(doc as any, title);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const filename = `${title}.docx`;
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      autoSaveToMediaLibrary(blob, filename, { source: 'word-editor' });
    } catch (error) {
      console.error('Export failed:', error);
      onDownload();
    }
  }, [editor, title, onDownload]);

  if (!editor) return null;

  return (
    <div className="h-full flex flex-col bg-background relative">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <h2 className="font-semibold text-lg truncate max-w-md">{title}</h2>
        <div className="flex items-center gap-2">
          {onSaveToLibrary && (
            <Button
              variant="outline"
              size="sm"
              onClick={onSaveToLibrary}
              data-testid="btn-save-to-library"
            >
              <BookOpen className="h-4 w-4 mr-1" />
              Guardar
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportWord}
            data-testid="btn-export-word"
          >
            <Download className="h-4 w-4 mr-1" />
            Export
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="bg-red-500 hover:bg-red-600 text-white rounded-md"
            data-testid="btn-close-editor"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <RibbonShell
        editor={editor}
        onDownload={handleExportWord}
        onAICommand={handleAICommand}
      >
        <div className="flex-1 overflow-auto bg-gray-100 dark:bg-gray-900">
          <div className="max-w-4xl mx-auto my-8 bg-white dark:bg-gray-800 shadow-lg rounded-sm min-h-[1100px]">
            <EditorContent editor={editor} className="min-h-[1100px]" />
          </div>
        </div>
      </RibbonShell>

      {showAiBar && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4">
          <div className="flex items-center gap-2 bg-background border rounded-lg shadow-lg p-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <Input
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="Ask AI to edit your document..."
              className="flex-1 border-0 focus-visible:ring-0"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleAIPromptSubmit();
                }
                if (e.key === 'Escape') {
                  setShowAiBar(false);
                }
              }}
              disabled={isAiProcessing}
              autoFocus
              data-testid="input-ai-prompt"
            />
            <Button
              size="sm"
              onClick={handleAIPromptSubmit}
              disabled={isAiProcessing || !aiPrompt.trim()}
              data-testid="btn-ai-submit"
            >
              {isAiProcessing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Apply'
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowAiBar(false)}
              data-testid="btn-ai-close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {isAiProcessing && !showAiBar && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
          <div className="flex items-center gap-2 bg-primary text-primary-foreground rounded-full px-4 py-2 shadow-lg">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">AI is editing...</span>
          </div>
        </div>
      )}
    </div>
  );
}
