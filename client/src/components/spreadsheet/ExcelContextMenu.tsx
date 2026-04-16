import React, { useState, useEffect, useRef } from 'react';
import {
  Scissors, Copy, Clipboard, ClipboardPaste,
  Plus, Minus, Trash2, Filter, ArrowUpDown,
  MessageSquare, StickyNote, Link2, Table2,
  ChevronRight, Type, Grid3X3,
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  Search, ListOrdered, Hash
} from 'lucide-react';

interface ContextMenuProps {
  x: number;
  y: number;
  isOpen: boolean;
  onClose: () => void;
  onAction: (action: string, params?: any) => void;
  selectedRange: { startRow: number; startCol: number; endRow: number; endCol: number } | null;
}

interface MenuItem {
  id: string;
  label: string;
  icon?: React.ComponentType<any>;
  shortcut?: string;
  divider?: boolean;
  submenu?: MenuItem[];
  disabled?: boolean;
  action?: string;
}

export function ExcelContextMenu({ x, y, isOpen, onClose, onAction, selectedRange }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);

  const menuItems: MenuItem[] = [
    { id: 'cut', label: 'Cortar', icon: Scissors, shortcut: '⌘X', action: 'cut' },
    { id: 'copy', label: 'Copiar', icon: Copy, shortcut: '⌘C', action: 'copy' },
    { id: 'paste', label: 'Pegar', icon: Clipboard, shortcut: '⌘V', action: 'paste' },
    {
      id: 'paste_special',
      label: 'Pegado especial',
      icon: ClipboardPaste,
      submenu: [
        { id: 'paste_values', label: 'Pegar valores', action: 'paste_values' },
        { id: 'paste_formulas', label: 'Pegar fórmulas', action: 'paste_formulas' },
        { id: 'paste_formats', label: 'Pegar formato', action: 'paste_formats' },
        { id: 'paste_transpose', label: 'Transponer', action: 'paste_transpose' },
        { id: 'paste_link', label: 'Pegar vínculo', action: 'paste_link' },
      ]
    },
    { id: 'divider1', label: '', divider: true },
    { id: 'search', label: 'Búsqueda inteligente...', icon: Search, shortcut: '⌘L', action: 'smart_search' },
    { id: 'divider2', label: '', divider: true },
    {
      id: 'insert',
      label: 'Insertar...',
      icon: Plus,
      submenu: [
        { id: 'insert_row_above', label: 'Fila arriba', action: 'insert_row_above' },
        { id: 'insert_row_below', label: 'Fila abajo', action: 'insert_row_below' },
        { id: 'insert_col_left', label: 'Columna izquierda', action: 'insert_col_left' },
        { id: 'insert_col_right', label: 'Columna derecha', action: 'insert_col_right' },
        { id: 'divider', label: '', divider: true },
        { id: 'insert_cells', label: 'Celdas...', action: 'insert_cells' },
      ]
    },
    {
      id: 'delete',
      label: 'Eliminar...',
      icon: Trash2,
      submenu: [
        { id: 'delete_rows', label: 'Eliminar filas', action: 'delete_rows' },
        { id: 'delete_cols', label: 'Eliminar columnas', action: 'delete_cols' },
        { id: 'delete_cells', label: 'Eliminar celdas...', action: 'delete_cells' },
      ]
    },
    { id: 'clear', label: 'Borrar contenido', icon: Minus, action: 'clear_contents' },
    { id: 'divider3', label: '', divider: true },
    {
      id: 'filter',
      label: 'Filtro',
      icon: Filter,
      submenu: [
        { id: 'filter_by_value', label: 'Filtrar por valor seleccionado', action: 'filter_by_value' },
        { id: 'filter_by_color', label: 'Filtrar por color', action: 'filter_by_color' },
        { id: 'clear_filter', label: 'Borrar filtro', action: 'clear_filter' },
      ]
    },
    {
      id: 'sort',
      label: 'Ordenar',
      icon: ArrowUpDown,
      submenu: [
        { id: 'sort_asc', label: 'Ordenar A → Z', icon: ArrowUp, action: 'sort_asc' },
        { id: 'sort_desc', label: 'Ordenar Z → A', icon: ArrowDown, action: 'sort_desc' },
        { id: 'sort_custom', label: 'Ordenar personalizado...', action: 'sort_custom' },
      ]
    },
    { id: 'divider4', label: '', divider: true },
    { id: 'comment', label: 'Nuevo comentario', icon: MessageSquare, action: 'add_comment' },
    { id: 'note', label: 'Nueva nota', icon: StickyNote, action: 'add_note' },
    { id: 'divider5', label: '', divider: true },
    { id: 'format_cells', label: 'Formato de celdas...', icon: Type, shortcut: '⌘1', action: 'format_cells' },
    { id: 'dropdown_list', label: 'Elegir de la lista desplegable...', icon: ListOrdered, action: 'dropdown_list' },
    { id: 'define_name', label: 'Definir nombre...', icon: Hash, action: 'define_name' },
    { id: 'divider6', label: '', divider: true },
    { id: 'hyperlink', label: 'Hipervínculo...', icon: Link2, shortcut: '⌘K', action: 'hyperlink' },
    { id: 'divider7', label: '', divider: true },
    {
      id: 'autofill',
      label: 'Autorrelleno',
      icon: Grid3X3,
      submenu: [
        { id: 'fill_down', label: 'Rellenar abajo', icon: ArrowDown, action: 'fill_down' },
        { id: 'fill_right', label: 'Rellenar derecha', icon: ArrowRight, action: 'fill_right' },
        { id: 'fill_up', label: 'Rellenar arriba', icon: ArrowUp, action: 'fill_up' },
        { id: 'fill_left', label: 'Rellenar izquierda', icon: ArrowLeft, action: 'fill_left' },
        { id: 'divider', label: '', divider: true },
        { id: 'fill_series', label: 'Series...', action: 'fill_series' },
      ]
    },
    { id: 'divider8', label: '', divider: true },
    {
      id: 'merge',
      label: 'Combinar celdas',
      icon: Table2,
      submenu: [
        { id: 'merge_all', label: 'Combinar y centrar', action: 'merge_all' },
        { id: 'merge_horizontal', label: 'Combinar horizontalmente', action: 'merge_horizontal' },
        { id: 'merge_vertical', label: 'Combinar verticalmente', action: 'merge_vertical' },
        { id: 'unmerge', label: 'Separar celdas', action: 'unmerge' },
      ]
    },
  ];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleItemClick = (item: MenuItem) => {
    if (item.submenu) {
      return;
    }
    if (item.action) {
      onAction(item.action);
    }
    onClose();
  };

  const handleSubmenuEnter = (itemId: string) => {
    setActiveSubmenu(itemId);
  };

  const renderMenuItem = (item: MenuItem) => {
    if (item.divider) {
      return <div key={item.id} className="h-px bg-gray-700 my-1" />;
    }

    const hasSubmenu = item.submenu && item.submenu.length > 0;
    const Icon = item.icon;

    return (
      <div
        key={item.id}
        className={`
          relative flex items-center gap-3 px-3 py-2 cursor-pointer
          ${item.disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-700'}
          ${activeSubmenu === item.id ? 'bg-gray-700' : ''}
        `}
        onClick={() => !item.disabled && handleItemClick(item)}
        onMouseEnter={() => hasSubmenu && handleSubmenuEnter(item.id)}
        onMouseLeave={() => !hasSubmenu && setActiveSubmenu(null)}
        data-testid={`context-menu-${item.id}`}
      >
        <div className="w-5 h-5 flex items-center justify-center">
          {Icon && <Icon className="w-4 h-4 text-gray-400" />}
        </div>
        <span className="flex-1 text-sm text-gray-200">{item.label}</span>
        {item.shortcut && (
          <span className="text-xs text-gray-500">{item.shortcut}</span>
        )}
        {hasSubmenu && (
          <ChevronRight className="w-4 h-4 text-gray-500" />
        )}

        {hasSubmenu && activeSubmenu === item.id && (
          <div
            className="absolute left-full top-0 ml-1 min-w-[200px] bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 z-50"
            onMouseEnter={() => setActiveSubmenu(item.id)}
            onMouseLeave={() => setActiveSubmenu(null)}
          >
            {item.submenu!.map(subItem => {
              if (subItem.divider) {
                return <div key={subItem.id} className="h-px bg-gray-700 my-1" />;
              }
              const SubIcon = subItem.icon;
              return (
                <div
                  key={subItem.id}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-gray-700 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (subItem.action) {
                      onAction(subItem.action);
                    }
                    onClose();
                  }}
                  data-testid={`context-menu-${subItem.id}`}
                >
                  <div className="w-5 h-5 flex items-center justify-center">
                    {SubIcon && <SubIcon className="w-4 h-4 text-gray-400" />}
                  </div>
                  <span className="text-sm text-gray-200">{subItem.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const adjustedX = Math.min(x, window.innerWidth - 250);
  const adjustedY = Math.min(y, window.innerHeight - 500);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[220px] bg-gray-800 border border-gray-700 rounded-lg shadow-2xl py-1 overflow-hidden"
      style={{ left: adjustedX, top: adjustedY }}
      data-testid="excel-context-menu"
    >
      {menuItems.map(renderMenuItem)}
    </div>
  );
}

export default ExcelContextMenu;
