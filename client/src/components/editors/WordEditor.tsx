import React, { useState, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import BubbleMenuExtension from '@tiptap/extension-bubble-menu';
import FloatingMenuExtension from '@tiptap/extension-floating-menu';
// Note: BubbleMenu and FloatingMenu React components are used directly from extensions
const BubbleMenu = ({ editor, children, ...props }: { editor: ReturnType<typeof useEditor>; children: React.ReactNode; tippyOptions?: object; className?: string }) => {
    if (!editor) return null;
    return <div {...props}>{children}</div>;
};
const FloatingMenu = ({ editor, children, ...props }: { editor: ReturnType<typeof useEditor>; children: React.ReactNode; tippyOptions?: object; className?: string }) => {
    if (!editor) return null;
    return <div {...props}>{children}</div>;
};
import {
    Bold, Italic, Underline as UnderlineIcon,
    AlignLeft, AlignCenter, AlignRight, AlignJustify,
    List, ListOrdered, Heading1, Heading2, Quote,
    Image as ImageIcon, Link as LinkIcon, Table as TableIcon,
    Trash2, PlusSquare
} from 'lucide-react';
import { OfficeToolShell, OfficeViewMode } from '../office/OfficeToolShell';
import { Toggle } from '@/components/ui/toggle';
import { Separator } from '@/components/ui/separator';

interface WordEditorProps {
    content?: string;
    onSave?: (content: string) => void;
    onClose: () => void;
    title?: string;
}

export default function WordEditor({
    content = '<p>Empieza a escribir...</p>',
    onSave,
    onClose,
    title = 'Documento sin título'
}: WordEditorProps) {
    const [viewMode, setViewMode] = useState<OfficeViewMode>('visual');
    const [htmlContent, setHtmlContent] = useState(content);

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
            Image,
            Link.configure({
                openOnClick: false,
            }),
            Placeholder.configure({
                placeholder: 'Escribe algo increíble... (Teclea "/" para comandos)',
            }),
            Table.configure({
                resizable: true,
            }),
            TableRow,
            TableHeader,
            TableCell,
            BubbleMenuExtension,
            FloatingMenuExtension,
        ],
        content: content,
        onUpdate: ({ editor }) => {
            setHtmlContent(editor.getHTML());
        },
        editorProps: {
            attributes: {
                class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl m-8 focus:outline-none max-w-none min-h-[1123px] w-[794px] bg-white shadow-2xl p-[96px] mx-auto border border-gray-200'
            }
        }
    });

    // Sync content when switching modes
    useEffect(() => {
        if (viewMode === 'visual' && editor && htmlContent !== editor.getHTML()) {
            editor.commands.setContent(htmlContent);
        }
    }, [viewMode, editor, htmlContent]);

    const handleDownload = async () => {
        try {
            const { default: htmlToDocx } = await import('html-to-docx');
            const fileBuffer = await htmlToDocx(htmlContent, null, {
                table: { row: { cantSplit: true } },
                footer: true,
                pageNumber: true,
            });

            const blob = new Blob([fileBuffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${title}.docx`;
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (e) {
            console.error("Export failed", e);
            alert("Error exporting to Docx");
        }
    };

    const handleSave = () => {
        onSave?.(htmlContent);
    };

    const Toolbar = () => {
        if (!editor) return null;

        return (
            <div className="flex items-center gap-1">
                <div className="flex items-center gap-0.5 bg-gray-100 p-0.5 rounded-lg border border-gray-200">
                    <Toggle
                        size="sm"
                        pressed={editor.isActive('bold')}
                        onPressedChange={() => editor.chain().focus().toggleBold().run()}
                        className="h-8 w-8 p-0 hover:bg-white hover:shadow-sm"
                        title="Negrita (Cmd+B)"
                    >
                        <Bold className="h-4 w-4" />
                    </Toggle>
                    <Toggle
                        size="sm"
                        pressed={editor.isActive('italic')}
                        onPressedChange={() => editor.chain().focus().toggleItalic().run()}
                        className="h-8 w-8 p-0 hover:bg-white hover:shadow-sm"
                        title="Cursiva (Cmd+I)"
                    >
                        <Italic className="h-4 w-4" />
                    </Toggle>
                    <Toggle
                        size="sm"
                        pressed={editor.isActive('underline')}
                        onPressedChange={() => editor.chain().focus().toggleUnderline().run()}
                        className="h-8 w-8 p-0 hover:bg-white hover:shadow-sm"
                        title="Subrayado (Cmd+U)"
                    >
                        <UnderlineIcon className="h-4 w-4" />
                    </Toggle>
                </div>

                <Separator orientation="vertical" className="h-6 mx-2" />

                <div className="flex items-center gap-0.5 bg-gray-100 p-0.5 rounded-lg border border-gray-200">
                    <Toggle
                        size="sm"
                        pressed={editor.isActive({ textAlign: 'left' })}
                        onPressedChange={() => editor.chain().focus().setTextAlign('left').run()}
                        className="h-8 w-8 p-0 hover:bg-white hover:shadow-sm"
                        title="Texto a la izquierda"
                    >
                        <AlignLeft className="h-4 w-4" />
                    </Toggle>
                    <Toggle
                        size="sm"
                        pressed={editor.isActive({ textAlign: 'center' })}
                        onPressedChange={() => editor.chain().focus().setTextAlign('center').run()}
                        className="h-8 w-8 p-0 hover:bg-white hover:shadow-sm"
                        title="Centrar texto"
                    >
                        <AlignCenter className="h-4 w-4" />
                    </Toggle>
                    <Toggle
                        size="sm"
                        pressed={editor.isActive({ textAlign: 'right' })}
                        onPressedChange={() => editor.chain().focus().setTextAlign('right').run()}
                        className="h-8 w-8 p-0 hover:bg-white hover:shadow-sm"
                        title="Texto a la derecha"
                    >
                        <AlignRight className="h-4 w-4" />
                    </Toggle>
                    <Toggle
                        size="sm"
                        pressed={editor.isActive({ textAlign: 'justify' })}
                        onPressedChange={() => editor.chain().focus().setTextAlign('justify').run()}
                        className="h-8 w-8 p-0 hover:bg-white hover:shadow-sm"
                        title="Justificar texto"
                    >
                        <AlignJustify className="h-4 w-4" />
                    </Toggle>
                </div>

                <Separator orientation="vertical" className="h-6 mx-2" />

                <div className="flex items-center gap-0.5 bg-gray-100 p-0.5 rounded-lg border border-gray-200">
                    <Toggle
                        size="sm"
                        pressed={editor.isActive('heading', { level: 1 })}
                        onPressedChange={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                        className="h-8 w-8 p-0 hover:bg-white hover:shadow-sm"
                        title="Título Principal"
                    >
                        <Heading1 className="h-4 w-4" />
                    </Toggle>
                    <Toggle
                        size="sm"
                        pressed={editor.isActive('heading', { level: 2 })}
                        onPressedChange={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                        className="h-8 w-8 p-0 hover:bg-white hover:shadow-sm"
                        title="Subtítulo"
                    >
                        <Heading2 className="h-4 w-4" />
                    </Toggle>
                </div>

                <Separator orientation="vertical" className="h-6 mx-2" />

                <div className="flex items-center gap-0.5 bg-gray-100 p-0.5 rounded-lg border border-gray-200">
                    <Toggle
                        size="sm"
                        pressed={editor.isActive('bulletList')}
                        onPressedChange={() => editor.chain().focus().toggleBulletList().run()}
                        className="h-8 w-8 p-0 hover:bg-white hover:shadow-sm"
                        title="Lista de viñetas"
                    >
                        <List className="h-4 w-4" />
                    </Toggle>
                    <Toggle
                        size="sm"
                        pressed={editor.isActive('orderedList')}
                        onPressedChange={() => editor.chain().focus().toggleOrderedList().run()}
                        className="h-8 w-8 p-0 hover:bg-white hover:shadow-sm"
                        title="Lista numerada"
                    >
                        <ListOrdered className="h-4 w-4" />
                    </Toggle>
                    <Toggle
                        size="sm"
                        pressed={editor.isActive('blockquote')}
                        onPressedChange={() => editor.chain().focus().toggleBlockquote().run()}
                        className="h-8 w-8 p-0 hover:bg-white hover:shadow-sm"
                        title="Cita"
                    >
                        <Quote className="h-4 w-4" />
                    </Toggle>
                </div>


                <Separator orientation="vertical" className="h-6 mx-2" />

                <div className="flex items-center gap-0.5 bg-gray-100 p-0.5 rounded-lg border border-gray-200">
                    <Toggle
                        size="sm"
                        onPressedChange={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
                        className="h-8 w-8 p-0 hover:bg-white hover:shadow-sm"
                        title="Insertar Tabla (3x3)"
                    >
                        <TableIcon className="h-4 w-4" />
                    </Toggle>
                    <Toggle
                        size="sm"
                        onPressedChange={() => editor.chain().focus().deleteTable().run()}
                        className="h-8 w-8 p-0 hover:bg-white hover:shadow-sm text-red-500 hover:text-red-600"
                        title="Eliminar Tabla"
                        disabled={!editor.can().deleteTable()}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Toggle>
                </div>
            </div >
        );
    };

    return (
        <OfficeToolShell
            title={title}
            type="word"
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onClose={onClose}
            onDownload={handleDownload}
            onSave={handleSave}
            toolbar={<Toolbar />}
        >
            {viewMode === 'visual' ? (
                <div className="h-full overflow-auto bg-[#eaddcf] dark:bg-neutral-900 p-8 flex justify-center w-full">
                    {/* Paper Simulation */}
                    {editor && (
                        <>
                            <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }} className="flex overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl">
                                <Toggle
                                    size="sm"
                                    pressed={editor.isActive('bold')}
                                    onPressedChange={() => editor.chain().focus().toggleBold().run()}
                                    className="h-8 w-8 p-1 hover:bg-gray-100 rounded-none"
                                >
                                    <Bold className="h-4 w-4" />
                                </Toggle>
                                <Toggle
                                    size="sm"
                                    pressed={editor.isActive('italic')}
                                    onPressedChange={() => editor.chain().focus().toggleItalic().run()}
                                    className="h-8 w-8 p-1 hover:bg-gray-100 rounded-none"
                                >
                                    <Italic className="h-4 w-4" />
                                </Toggle>
                                <Toggle
                                    size="sm"
                                    pressed={editor.isActive('underline')}
                                    onPressedChange={() => editor.chain().focus().toggleUnderline().run()}
                                    className="h-8 w-8 p-1 hover:bg-gray-100 rounded-none"
                                >
                                    <UnderlineIcon className="h-4 w-4" />
                                </Toggle>
                                <Separator orientation="vertical" className="h-8" />
                                <Toggle
                                    size="sm"
                                    pressed={editor.isActive('heading', { level: 2 })}
                                    onPressedChange={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                                    className="h-8 w-8 p-1 hover:bg-gray-100 rounded-none"
                                >
                                    <Heading2 className="h-4 w-4" />
                                </Toggle>
                            </BubbleMenu>

                            <FloatingMenu editor={editor} tippyOptions={{ duration: 100 }} className="flex overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl px-1 py-1 gap-1">
                                <Toggle
                                    size="sm"
                                    pressed={editor.isActive('heading', { level: 1 })}
                                    onPressedChange={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                                    className="h-8 px-2 hover:bg-gray-100 text-xs font-medium w-auto"
                                >
                                    Título 1
                                </Toggle>
                                <Toggle
                                    size="sm"
                                    pressed={editor.isActive('bulletList')}
                                    onPressedChange={() => editor.chain().focus().toggleBulletList().run()}
                                    className="h-8 px-2 hover:bg-gray-100 text-xs font-medium w-auto"
                                >
                                    Lista
                                </Toggle>
                            </FloatingMenu>
                        </>
                    )}
                    <EditorContent editor={editor} className="origin-top scale-[0.85] sm:scale-100 transition-transform duration-200" />
                </div>
            ) : (
                <div className="h-full w-full bg-[#1e1e1e] p-4 font-mono text-sm">
                    <textarea
                        className="w-full h-full bg-transparent text-[#d4d4d4] resize-none focus:outline-none leading-relaxed"
                        value={htmlContent}
                        onChange={(e) => setHtmlContent(e.target.value)}
                        spellCheck={false}
                        aria-label="Editor de código fuente HTML"
                    />
                </div>
            )}
        </OfficeToolShell>
    );
}
