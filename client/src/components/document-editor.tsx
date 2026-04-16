import { useEffect, useCallback, useRef } from 'react';
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
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { markdownToTipTap } from '@/lib/markdownToHtml';
import 'katex/dist/katex.min.css';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Undo,
  Redo,
  Link as LinkIcon,
  Image as ImageIcon,
  Table as TableIcon,
  X,
  Download,
} from 'lucide-react';

interface DocumentEditorProps {
  title: string;
  content: string;
  onChange: (content: string) => void;
  onClose: () => void;
  onDownload: () => void;
  documentType: 'word' | 'excel' | 'ppt';
  onTextSelect?: (text: string, applyRewrite: (newText: string) => void) => void;
  onTextDeselect?: () => void;
  onInsertContent?: (insertFn: (content: string, replaceMode?: boolean) => void) => void;
}

const fontFamilies = [
  { label: 'Inter', value: 'Inter, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", serif' },
  { label: 'Playfair Display', value: '"Playfair Display", serif' },
];

const fontSizes = ['12', '14', '16', '18', '20', '24', '28', '32', '36', '48'];

export function DocumentEditor({
  title,
  content,
  onChange,
  onClose,
  onDownload,
  documentType,
  onTextSelect,
  onTextDeselect,
  onInsertContent,
}: DocumentEditorProps) {
  const savedRangeRef = useRef<Range | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      TextStyle,
      FontFamily,
      Color,
      Highlight.configure({
        multicolor: true,
      }),
      Link.configure({
        openOnClick: false,
      }),
      Image,
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableCell,
      TableHeader,
      MathExtension.configure({
        evaluation: false,
        delimiters: 'dollar',
        katexOptions: {
          throwOnError: false,
          displayMode: false,
        },
      }),
    ],
    content: markdownToTipTap(content),
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'prose prose-lg max-w-none focus:outline-none min-h-[800px] template-emily',
      },
    },
  });

  const applyRewrite = useCallback((newText: string) => {
    if (!editor || !savedRangeRef.current) return;

    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(savedRangeRef.current);
    }

    editor.chain().focus().deleteSelection().insertContent(newText).run();
    savedRangeRef.current = null;
  }, [editor]);

  const handleTextSelection = useCallback(() => {
    if (!editor || !onTextSelect) return;
    
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      return;
    }

    const text = selection.toString();
    if (text.trim().length < 2) return;

    savedRangeRef.current = selection.getRangeAt(0).cloneRange();
    onTextSelect(text, applyRewrite);
  }, [editor, onTextSelect, applyRewrite]);

  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.page-container')) {
        setTimeout(handleTextSelection, 10);
      }
    };

    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleTextSelection]);

  // Content insertion with optional replace mode for streaming
  useEffect(() => {
    if (editor && onInsertContent) {
      const insertContent = (text: string, replaceMode = false) => {
        if (!editor || editor.isDestroyed) {
          console.warn('[DocumentEditor] Editor not available');
          return;
        }
        
        if (!text || text.trim() === '') return;
        
        // Use AST-based markdown to HTML conversion that preserves math for TipTap
        const htmlContent = markdownToTipTap(text);
        
        if (replaceMode) {
          // Replace entire content - used for streaming to show progressive content
          editor.commands.setContent(htmlContent);
        } else {
          // Append to end - original behavior
          editor.chain()
            .focus('end')
            .insertContent(htmlContent)
            .run();
        }
      };
      
      onInsertContent(insertContent);
    }
  }, [editor, onInsertContent]);

  if (!editor) return null;

  return (
    <div className="document-editor-container flex h-full bg-gray-100 dark:bg-gray-900">
      {/* Workspace */}
      <div className="workspace flex-1 flex flex-col overflow-hidden">
        {/* Top Action Bar */}
        <div className="action-bar flex items-center justify-between px-4 py-2 bg-white dark:bg-gray-800 border-b">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{title}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="default" size="sm" onClick={onDownload} className="gap-2">
              <Download className="h-4 w-4" />
              Descargar
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Sticky Toolbar */}
        <div className="toolbar sticky top-0 z-50 bg-white dark:bg-gray-800 border-b px-4 py-2">
          <div className="flex items-center gap-1 flex-wrap">
            {/* Undo/Redo */}
            <div className="flex items-center gap-0.5 pr-2 border-r">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => editor.chain().focus().undo().run()}
                disabled={!editor.can().undo()}
              >
                <Undo className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => editor.chain().focus().redo().run()}
                disabled={!editor.can().redo()}
              >
                <Redo className="h-4 w-4" />
              </Button>
            </div>

            {/* Text Style Dropdown */}
            <div className="flex items-center gap-1 px-2 border-r">
              <select
                className="text-xs border rounded px-2 py-1.5 bg-transparent min-w-[100px]"
                value={
                  editor.isActive('heading', { level: 1 })
                    ? 'h1'
                    : editor.isActive('heading', { level: 2 })
                    ? 'h2'
                    : editor.isActive('heading', { level: 3 })
                    ? 'h3'
                    : 'p'
                }
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === 'p') {
                    editor.chain().focus().setParagraph().run();
                  } else {
                    const level = parseInt(value.replace('h', '')) as 1 | 2 | 3;
                    editor.chain().focus().toggleHeading({ level }).run();
                  }
                }}
              >
                <option value="p">Normal Text</option>
                <option value="h1">Heading 1</option>
                <option value="h2">Heading 2</option>
                <option value="h3">Heading 3</option>
              </select>

              <select
                className="text-xs border rounded px-2 py-1.5 bg-transparent min-w-[90px]"
                onChange={(e) => {
                  editor.chain().focus().setFontFamily(e.target.value).run();
                }}
              >
                {fontFamilies.map((font) => (
                  <option key={font.value} value={font.value}>
                    {font.label}
                  </option>
                ))}
              </select>

              <select
                className="text-xs border rounded px-2 py-1.5 bg-transparent w-16"
                onChange={(e) => {
                  // Font size would need a custom extension
                }}
              >
                {fontSizes.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>

            {/* Text Formatting */}
            <div className="flex items-center gap-0.5 px-2 border-r">
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', editor.isActive('bold') && 'bg-gray-200 dark:bg-gray-700')}
                onClick={() => editor.chain().focus().toggleBold().run()}
              >
                <Bold className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', editor.isActive('italic') && 'bg-gray-200 dark:bg-gray-700')}
                onClick={() => editor.chain().focus().toggleItalic().run()}
              >
                <Italic className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', editor.isActive('underline') && 'bg-gray-200 dark:bg-gray-700')}
                onClick={() => editor.chain().focus().toggleUnderline().run()}
              >
                <UnderlineIcon className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', editor.isActive('strike') && 'bg-gray-200 dark:bg-gray-700')}
                onClick={() => editor.chain().focus().toggleStrike().run()}
              >
                <Strikethrough className="h-4 w-4" />
              </Button>
            </div>

            {/* Alignment */}
            <div className="flex items-center gap-0.5 px-2 border-r">
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', editor.isActive({ textAlign: 'left' }) && 'bg-gray-200 dark:bg-gray-700')}
                onClick={() => editor.chain().focus().setTextAlign('left').run()}
              >
                <AlignLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', editor.isActive({ textAlign: 'center' }) && 'bg-gray-200 dark:bg-gray-700')}
                onClick={() => editor.chain().focus().setTextAlign('center').run()}
              >
                <AlignCenter className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', editor.isActive({ textAlign: 'right' }) && 'bg-gray-200 dark:bg-gray-700')}
                onClick={() => editor.chain().focus().setTextAlign('right').run()}
              >
                <AlignRight className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', editor.isActive({ textAlign: 'justify' }) && 'bg-gray-200 dark:bg-gray-700')}
                onClick={() => editor.chain().focus().setTextAlign('justify').run()}
              >
                <AlignJustify className="h-4 w-4" />
              </Button>
            </div>

            {/* Lists */}
            <div className="flex items-center gap-0.5 px-2">
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', editor.isActive('bulletList') && 'bg-gray-200 dark:bg-gray-700')}
                onClick={() => editor.chain().focus().toggleBulletList().run()}
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', editor.isActive('orderedList') && 'bg-gray-200 dark:bg-gray-700')}
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
              >
                <ListOrdered className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Document Canvas Area */}
        <div className="canvas-area">
          <div className="page-container">
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
    </div>
  );
}
