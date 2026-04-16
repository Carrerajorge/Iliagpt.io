import { useState, useCallback } from 'react';
import type { Editor } from '@tiptap/react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Undo,
  Redo,
  Link,
  Image,
  Table,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  Code,
  Minus,
  Palette,
  Highlighter,
  Save,
  Printer,
  FileDown,
  TableProperties,
  Plus,
  Trash2,
  LayoutGrid,
  ZoomIn,
  ZoomOut,
  Eye,
  Columns,
  BookOpen,
  FileText,
  Sparkles,
} from 'lucide-react';
import { commandBus, getEditorState } from '@/lib/commands';

type RibbonTab = 'home' | 'insert' | 'layout' | 'references' | 'review' | 'view' | 'ai';

interface RibbonShellProps {
  editor: Editor | null;
  onDownload?: () => void;
  onAICommand?: (command: string) => void;
  children: React.ReactNode;
}

const TEXT_COLORS = [
  '#000000', '#5c5c5c', '#a6a6a6',
  '#c00000', '#ff0000', '#ffc000',
  '#ffff00', '#92d050', '#00b050',
  '#00b0f0', '#0070c0', '#002060',
  '#7030a0', '#ffffff',
];

const HIGHLIGHT_COLORS = [
  '#ffff00', '#00ff00', '#00ffff',
  '#ff00ff', '#0000ff', '#ff0000',
  '#000080', '#008080', '#008000',
  '#800080', '#800000', '#808000',
  '#c0c0c0', '#808080',
];

export function RibbonShell({ editor, onDownload, onAICommand, children }: RibbonShellProps) {
  const [activeTab, setActiveTab] = useState<RibbonTab>('home');
  const editorState = editor ? getEditorState(editor) : null;

  const executeCommand = useCallback((name: string, payload?: Record<string, unknown>) => {
    commandBus.applyCommand(name, payload || {}, 'ribbon');
  }, []);

  const renderQuickAccess = () => (
    <div className="flex items-center gap-1 px-2 py-1 border-b bg-muted/30">
      <RibbonButton
        icon={<Save className="h-3.5 w-3.5" />}
        tooltip="Save"
        onClick={onDownload}
        size="sm"
      />
      <RibbonButton
        icon={<Undo className="h-3.5 w-3.5" />}
        tooltip="Undo (Ctrl+Z)"
        onClick={() => executeCommand('undo')}
        disabled={!editorState?.canUndo}
        size="sm"
      />
      <RibbonButton
        icon={<Redo className="h-3.5 w-3.5" />}
        tooltip="Redo (Ctrl+Y)"
        onClick={() => executeCommand('redo')}
        disabled={!editorState?.canRedo}
        size="sm"
      />
    </div>
  );

  const renderTabs = () => (
    <div className="flex items-center border-b bg-background">
      {(['home', 'insert', 'layout', 'references', 'review', 'view', 'ai'] as RibbonTab[]).map((tab) => (
        <button
          key={tab}
          onClick={() => setActiveTab(tab)}
          className={cn(
            'px-4 py-1.5 text-sm font-medium capitalize transition-colors',
            activeTab === tab
              ? 'bg-background border-b-2 border-primary text-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          )}
          data-testid={`tab-${tab}`}
        >
          {tab === 'ai' ? (
            <span className="flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5" />
              AI
            </span>
          ) : tab}
        </button>
      ))}
    </div>
  );

  const renderHomeTab = () => (
    <div className="flex items-center gap-4 p-2">
      <RibbonGroup label="Clipboard">
        <RibbonButton
          icon={<FileDown className="h-4 w-4" />}
          label="Paste"
          tooltip="Paste"
          onClick={() => document.execCommand('paste')}
        />
      </RibbonGroup>

      <RibbonGroup label="Font">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <Select
              defaultValue="Inter, sans-serif"
              onValueChange={(value) => executeCommand('setFontFamily', { fontFamily: value })}
            >
              <SelectTrigger className="h-7 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Inter, sans-serif">Inter</SelectItem>
                <SelectItem value="Georgia, serif">Georgia</SelectItem>
                <SelectItem value="Arial, sans-serif">Arial</SelectItem>
                <SelectItem value="'Times New Roman', serif">Times</SelectItem>
              </SelectContent>
            </Select>
            <Select defaultValue="16">
              <SelectTrigger className="h-7 w-14 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['12', '14', '16', '18', '20', '24', '28', '32'].map((size) => (
                  <SelectItem key={size} value={size}>{size}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-0.5">
            <RibbonButton
              icon={<Bold className="h-4 w-4" />}
              tooltip="Bold (Ctrl+B)"
              onClick={() => executeCommand('bold')}
              active={editorState?.isBold}
              size="sm"
            />
            <RibbonButton
              icon={<Italic className="h-4 w-4" />}
              tooltip="Italic (Ctrl+I)"
              onClick={() => executeCommand('italic')}
              active={editorState?.isItalic}
              size="sm"
            />
            <RibbonButton
              icon={<Underline className="h-4 w-4" />}
              tooltip="Underline (Ctrl+U)"
              onClick={() => executeCommand('underline')}
              active={editorState?.isUnderline}
              size="sm"
            />
            <RibbonButton
              icon={<Strikethrough className="h-4 w-4" />}
              tooltip="Strikethrough"
              onClick={() => executeCommand('strikethrough')}
              active={editorState?.isStrike}
              size="sm"
            />
            <Separator orientation="vertical" className="h-5 mx-1" />
            <ColorPicker
              colors={TEXT_COLORS}
              icon={<Palette className="h-4 w-4" />}
              tooltip="Text Color"
              onSelect={(color) => executeCommand('setTextColor', { color })}
            />
            <ColorPicker
              colors={HIGHLIGHT_COLORS}
              icon={<Highlighter className="h-4 w-4" />}
              tooltip="Highlight"
              onSelect={(color) => executeCommand('setHighlight', { color })}
            />
          </div>
        </div>
      </RibbonGroup>

      <RibbonGroup label="Paragraph">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-0.5">
            <RibbonButton
              icon={<List className="h-4 w-4" />}
              tooltip="Bullet List"
              onClick={() => executeCommand('bulletList')}
              active={editorState?.isBulletList}
              size="sm"
            />
            <RibbonButton
              icon={<ListOrdered className="h-4 w-4" />}
              tooltip="Numbered List"
              onClick={() => executeCommand('orderedList')}
              active={editorState?.isOrderedList}
              size="sm"
            />
          </div>
          <div className="flex items-center gap-0.5">
            <RibbonButton
              icon={<AlignLeft className="h-4 w-4" />}
              tooltip="Align Left"
              onClick={() => executeCommand('alignLeft')}
              active={editorState?.textAlign === 'left'}
              size="sm"
            />
            <RibbonButton
              icon={<AlignCenter className="h-4 w-4" />}
              tooltip="Align Center"
              onClick={() => executeCommand('alignCenter')}
              active={editorState?.textAlign === 'center'}
              size="sm"
            />
            <RibbonButton
              icon={<AlignRight className="h-4 w-4" />}
              tooltip="Align Right"
              onClick={() => executeCommand('alignRight')}
              active={editorState?.textAlign === 'right'}
              size="sm"
            />
            <RibbonButton
              icon={<AlignJustify className="h-4 w-4" />}
              tooltip="Justify"
              onClick={() => executeCommand('alignJustify')}
              active={editorState?.textAlign === 'justify'}
              size="sm"
            />
          </div>
        </div>
      </RibbonGroup>

      <RibbonGroup label="Styles">
        <div className="flex items-center gap-1">
          <RibbonButton
            icon={<Heading1 className="h-4 w-4" />}
            tooltip="Heading 1"
            onClick={() => executeCommand('heading1')}
            active={editorState?.isHeading1}
          />
          <RibbonButton
            icon={<Heading2 className="h-4 w-4" />}
            tooltip="Heading 2"
            onClick={() => executeCommand('heading2')}
            active={editorState?.isHeading2}
          />
          <RibbonButton
            icon={<Heading3 className="h-4 w-4" />}
            tooltip="Heading 3"
            onClick={() => executeCommand('heading3')}
            active={editorState?.isHeading3}
          />
        </div>
      </RibbonGroup>
    </div>
  );

  const renderInsertTab = () => (
    <div className="flex items-center gap-4 p-2">
      <RibbonGroup label="Tables">
        <RibbonButton
          icon={<Table className="h-5 w-5" />}
          label="Table"
          tooltip="Insert Table"
          onClick={() => executeCommand('insertTable', { rows: 3, cols: 3 })}
        />
      </RibbonGroup>

      <RibbonGroup label="Illustrations">
        <RibbonButton
          icon={<Image className="h-5 w-5" />}
          label="Image"
          tooltip="Insert Image"
          onClick={() => {
            const url = prompt('Enter image URL:');
            if (url) executeCommand('insertImage', { src: url });
          }}
        />
      </RibbonGroup>

      <RibbonGroup label="Links">
        <RibbonButton
          icon={<Link className="h-5 w-5" />}
          label="Link"
          tooltip="Insert Link"
          onClick={() => {
            const url = prompt('Enter URL:');
            if (url) executeCommand('insertLink', { url });
          }}
          active={editorState?.isLink}
        />
      </RibbonGroup>

      <RibbonGroup label="Text">
        <div className="flex items-center gap-1">
          <RibbonButton
            icon={<Quote className="h-4 w-4" />}
            tooltip="Blockquote"
            onClick={() => executeCommand('blockquote')}
            active={editorState?.isBlockquote}
          />
          <RibbonButton
            icon={<Code className="h-4 w-4" />}
            tooltip="Code Block"
            onClick={() => executeCommand('codeBlock')}
            active={editorState?.isCodeBlock}
          />
          <RibbonButton
            icon={<Minus className="h-4 w-4" />}
            tooltip="Horizontal Rule"
            onClick={() => executeCommand('insertHorizontalRule')}
          />
        </div>
      </RibbonGroup>
    </div>
  );

  const renderLayoutTab = () => (
    <div className="flex items-center gap-4 p-2">
      <RibbonGroup label="Page Setup">
        <div className="flex items-center gap-1">
          <RibbonButton
            icon={<FileText className="h-5 w-5" />}
            label="Margins"
            tooltip="Page Margins"
          />
          <RibbonButton
            icon={<Columns className="h-5 w-5" />}
            label="Columns"
            tooltip="Columns"
          />
        </div>
      </RibbonGroup>

      <RibbonGroup label="Paragraph">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Spacing options</span>
        </div>
      </RibbonGroup>
    </div>
  );

  const renderReferencesTab = () => (
    <div className="flex items-center gap-4 p-2">
      <RibbonGroup label="Table of Contents">
        <RibbonButton
          icon={<BookOpen className="h-5 w-5" />}
          label="TOC"
          tooltip="Insert Table of Contents"
        />
      </RibbonGroup>
    </div>
  );

  const renderReviewTab = () => (
    <div className="flex items-center gap-4 p-2">
      <RibbonGroup label="Proofing">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Spelling & Grammar</span>
        </div>
      </RibbonGroup>
    </div>
  );

  const renderViewTab = () => (
    <div className="flex items-center gap-4 p-2">
      <RibbonGroup label="Zoom">
        <div className="flex items-center gap-1">
          <RibbonButton icon={<ZoomOut className="h-4 w-4" />} tooltip="Zoom Out" />
          <span className="text-xs px-2">100%</span>
          <RibbonButton icon={<ZoomIn className="h-4 w-4" />} tooltip="Zoom In" />
        </div>
      </RibbonGroup>

      <RibbonGroup label="Show">
        <div className="flex items-center gap-1">
          <RibbonButton
            icon={<LayoutGrid className="h-4 w-4" />}
            tooltip="Gridlines"
          />
          <RibbonButton
            icon={<Eye className="h-4 w-4" />}
            tooltip="Preview"
          />
        </div>
      </RibbonGroup>
    </div>
  );

  const renderAITab = () => (
    <div className="flex items-center gap-4 p-2">
      <RibbonGroup label="AI Assistant">
        <div className="flex items-center gap-2">
          <RibbonButton
            icon={<Sparkles className="h-5 w-5" />}
            label="Ask AI"
            tooltip="Open AI command bar"
            onClick={() => onAICommand?.('open')}
          />
        </div>
      </RibbonGroup>
      <RibbonGroup label="Quick Actions">
        <div className="flex items-center gap-1">
          <RibbonButton
            label="Summarize"
            tooltip="Summarize selected text"
            onClick={() => onAICommand?.('summarize')}
            size="sm"
          />
          <RibbonButton
            label="Improve"
            tooltip="Improve writing"
            onClick={() => onAICommand?.('improve')}
            size="sm"
          />
          <RibbonButton
            label="Simplify"
            tooltip="Simplify text"
            onClick={() => onAICommand?.('simplify')}
            size="sm"
          />
        </div>
      </RibbonGroup>
    </div>
  );

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'home': return renderHomeTab();
      case 'insert': return renderInsertTab();
      case 'layout': return renderLayoutTab();
      case 'references': return renderReferencesTab();
      case 'review': return renderReviewTab();
      case 'view': return renderViewTab();
      case 'ai': return renderAITab();
      default: return null;
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col h-full bg-background">
        {renderQuickAccess()}
        {renderTabs()}
        <div className="border-b bg-muted/20 min-h-[72px]">
          {renderActiveTab()}
        </div>
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </div>
    </TooltipProvider>
  );
}

interface RibbonButtonProps {
  icon?: React.ReactNode;
  label?: string;
  tooltip?: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

function RibbonButton({ icon, label, tooltip, onClick, active, disabled, size = 'md' }: RibbonButtonProps) {
  const button = (
    <Button
      variant={active ? 'secondary' : 'ghost'}
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex flex-col items-center justify-center gap-0.5',
        size === 'sm' ? 'h-7 w-7 p-1' : 'h-auto min-h-[48px] px-2 py-1',
        active && 'bg-accent'
      )}
      data-testid={`ribbon-btn-${label?.toLowerCase().replace(/\s+/g, '-') || 'icon'}`}
    >
      {icon}
      {label && size !== 'sm' && <span className="text-[10px] leading-tight">{label}</span>}
    </Button>
  );

  if (!tooltip) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

interface RibbonGroupProps {
  label: string;
  children: React.ReactNode;
}

function RibbonGroup({ label, children }: RibbonGroupProps) {
  return (
    <div className="flex flex-col">
      <div className="flex items-end gap-1">
        {children}
      </div>
      <div className="text-[10px] text-muted-foreground text-center mt-1 border-t pt-0.5">
        {label}
      </div>
    </div>
  );
}

interface ColorPickerProps {
  colors: string[];
  icon: React.ReactNode;
  tooltip: string;
  onSelect: (color: string) => void;
}

function ColorPicker({ colors, icon, tooltip, onSelect }: ColorPickerProps) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-1">
              {icon}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {tooltip}
        </TooltipContent>
      </Tooltip>
      <PopoverContent className="w-auto p-2">
        <div className="grid grid-cols-7 gap-1">
          {colors.map((color) => (
            <button
              key={color}
              onClick={() => onSelect(color)}
              className="w-5 h-5 rounded border border-border hover:scale-110 transition-transform"
              style={{ backgroundColor: color }}
              data-testid={`color-${color}`}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
