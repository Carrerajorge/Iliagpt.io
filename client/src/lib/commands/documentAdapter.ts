import type { Editor } from '@tiptap/react';
import { commandBus, type CommandDefinition } from './commandBus';

export const documentCommands: CommandDefinition[] = [
  {
    name: 'bold',
    label: 'Bold',
    shortcut: 'Ctrl+B',
    handler: ({ editor }) => editor.chain().focus().toggleBold().run(),
  },
  {
    name: 'italic',
    label: 'Italic',
    shortcut: 'Ctrl+I',
    handler: ({ editor }) => editor.chain().focus().toggleItalic().run(),
  },
  {
    name: 'underline',
    label: 'Underline',
    shortcut: 'Ctrl+U',
    handler: ({ editor }) => editor.chain().focus().toggleUnderline().run(),
  },
  {
    name: 'strikethrough',
    label: 'Strikethrough',
    handler: ({ editor }) => editor.chain().focus().toggleStrike().run(),
  },
  {
    name: 'heading1',
    label: 'Heading 1',
    handler: ({ editor }) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    name: 'heading2',
    label: 'Heading 2',
    handler: ({ editor }) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    name: 'heading3',
    label: 'Heading 3',
    handler: ({ editor }) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    name: 'paragraph',
    label: 'Paragraph',
    handler: ({ editor }) => editor.chain().focus().setParagraph().run(),
  },
  {
    name: 'bulletList',
    label: 'Bullet List',
    handler: ({ editor }) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    name: 'orderedList',
    label: 'Numbered List',
    handler: ({ editor }) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    name: 'alignLeft',
    label: 'Align Left',
    handler: ({ editor }) => editor.chain().focus().setTextAlign('left').run(),
  },
  {
    name: 'alignCenter',
    label: 'Align Center',
    handler: ({ editor }) => editor.chain().focus().setTextAlign('center').run(),
  },
  {
    name: 'alignRight',
    label: 'Align Right',
    handler: ({ editor }) => editor.chain().focus().setTextAlign('right').run(),
  },
  {
    name: 'alignJustify',
    label: 'Justify',
    handler: ({ editor }) => editor.chain().focus().setTextAlign('justify').run(),
  },
  {
    name: 'undo',
    label: 'Undo',
    shortcut: 'Ctrl+Z',
    handler: ({ editor }) => editor.chain().focus().undo().run(),
  },
  {
    name: 'redo',
    label: 'Redo',
    shortcut: 'Ctrl+Y',
    handler: ({ editor }) => editor.chain().focus().redo().run(),
  },
  {
    name: 'insertLink',
    label: 'Insert Link',
    handler: ({ editor, payload }) => {
      const url = payload.url as string;
      if (!url) return false;
      return editor.chain().focus().setLink({ href: url }).run();
    },
  },
  {
    name: 'removeLink',
    label: 'Remove Link',
    handler: ({ editor }) => editor.chain().focus().unsetLink().run(),
  },
  {
    name: 'insertImage',
    label: 'Insert Image',
    handler: ({ editor, payload }) => {
      const src = payload.src as string;
      if (!src) return false;
      return editor.chain().focus().setImage({ src }).run();
    },
  },
  {
    name: 'insertTable',
    label: 'Insert Table',
    handler: ({ editor, payload }) => {
      const rows = (payload.rows as number) || 3;
      const cols = (payload.cols as number) || 3;
      return editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
    },
  },
  {
    name: 'deleteTable',
    label: 'Delete Table',
    handler: ({ editor }) => editor.chain().focus().deleteTable().run(),
  },
  {
    name: 'addTableRowBefore',
    label: 'Add Row Before',
    handler: ({ editor }) => editor.chain().focus().addRowBefore().run(),
  },
  {
    name: 'addTableRowAfter',
    label: 'Add Row After',
    handler: ({ editor }) => editor.chain().focus().addRowAfter().run(),
  },
  {
    name: 'deleteTableRow',
    label: 'Delete Row',
    handler: ({ editor }) => editor.chain().focus().deleteRow().run(),
  },
  {
    name: 'addTableColumnBefore',
    label: 'Add Column Before',
    handler: ({ editor }) => editor.chain().focus().addColumnBefore().run(),
  },
  {
    name: 'addTableColumnAfter',
    label: 'Add Column After',
    handler: ({ editor }) => editor.chain().focus().addColumnAfter().run(),
  },
  {
    name: 'deleteTableColumn',
    label: 'Delete Column',
    handler: ({ editor }) => editor.chain().focus().deleteColumn().run(),
  },
  {
    name: 'setFontFamily',
    label: 'Font Family',
    handler: ({ editor, payload }) => {
      const fontFamily = payload.fontFamily as string;
      if (!fontFamily) return false;
      return editor.chain().focus().setFontFamily(fontFamily).run();
    },
  },
  {
    name: 'setTextColor',
    label: 'Text Color',
    handler: ({ editor, payload }) => {
      const color = payload.color as string;
      if (!color) return false;
      return editor.chain().focus().setColor(color).run();
    },
  },
  {
    name: 'setHighlight',
    label: 'Highlight',
    handler: ({ editor, payload }) => {
      const color = payload.color as string;
      if (!color) return editor.chain().focus().toggleHighlight().run();
      return editor.chain().focus().toggleHighlight({ color }).run();
    },
  },
  {
    name: 'clearFormatting',
    label: 'Clear Formatting',
    handler: ({ editor }) => editor.chain().focus().clearNodes().unsetAllMarks().run(),
  },
  {
    name: 'insertText',
    label: 'Insert Text',
    handler: ({ editor, payload }) => {
      const text = payload.text as string;
      if (!text) return false;
      return editor.chain().focus().insertContent(text).run();
    },
  },
  {
    name: 'replaceSelection',
    label: 'Replace Selection',
    handler: ({ editor, payload }) => {
      const content = payload.content as string;
      if (!content) return false;
      return editor.chain().focus().deleteSelection().insertContent(content).run();
    },
  },
  {
    name: 'insertHorizontalRule',
    label: 'Horizontal Rule',
    handler: ({ editor }) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    name: 'blockquote',
    label: 'Blockquote',
    handler: ({ editor }) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    name: 'codeBlock',
    label: 'Code Block',
    handler: ({ editor }) => editor.chain().focus().toggleCodeBlock().run(),
  },
];

export function initializeDocumentAdapter(editor: Editor): void {
  commandBus.setEditor(editor);
  commandBus.registerCommands(documentCommands);
}

export function getEditorState(editor: Editor) {
  return {
    isBold: editor.isActive('bold'),
    isItalic: editor.isActive('italic'),
    isUnderline: editor.isActive('underline'),
    isStrike: editor.isActive('strike'),
    isHeading1: editor.isActive('heading', { level: 1 }),
    isHeading2: editor.isActive('heading', { level: 2 }),
    isHeading3: editor.isActive('heading', { level: 3 }),
    isBulletList: editor.isActive('bulletList'),
    isOrderedList: editor.isActive('orderedList'),
    isBlockquote: editor.isActive('blockquote'),
    isCodeBlock: editor.isActive('codeBlock'),
    textAlign: editor.isActive({ textAlign: 'center' })
      ? 'center'
      : editor.isActive({ textAlign: 'right' })
      ? 'right'
      : editor.isActive({ textAlign: 'justify' })
      ? 'justify'
      : 'left',
    isLink: editor.isActive('link'),
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
  };
}
