/**
 * Accessibility Utilities
 * Helpers for implementing WCAG 2.1 AA compliance
 */

/**
 * Generate unique IDs for ARIA relationships
 */
let idCounter = 0;
export function generateAriaId(prefix: string = 'aria'): string {
  return `${prefix}-${++idCounter}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Props for accessible dropdown/menu triggers
 */
export interface AccessibleTriggerProps {
  'aria-haspopup': true | 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog';
  'aria-expanded': boolean;
  'aria-controls'?: string;
}

export function getDropdownTriggerProps(
  isOpen: boolean,
  controlsId?: string,
  type: 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog' = 'menu'
): AccessibleTriggerProps {
  return {
    'aria-haspopup': type,
    'aria-expanded': isOpen,
    ...(controlsId && { 'aria-controls': controlsId }),
  };
}

/**
 * Props for accessible toggle buttons
 */
export interface AccessibleToggleProps {
  'aria-pressed': boolean;
  role: 'button';
}

export function getToggleButtonProps(isPressed: boolean): AccessibleToggleProps {
  return {
    'aria-pressed': isPressed,
    role: 'button',
  };
}

/**
 * Props for accessible tabs
 */
export interface AccessibleTabProps {
  role: 'tab';
  'aria-selected': boolean;
  'aria-controls': string;
  tabIndex: number;
}

export function getTabProps(
  isSelected: boolean,
  panelId: string
): AccessibleTabProps {
  return {
    role: 'tab',
    'aria-selected': isSelected,
    'aria-controls': panelId,
    tabIndex: isSelected ? 0 : -1,
  };
}

/**
 * Props for accessible tab panels
 */
export interface AccessibleTabPanelProps {
  role: 'tabpanel';
  'aria-labelledby': string;
  tabIndex: number;
  hidden?: boolean;
}

export function getTabPanelProps(
  tabId: string,
  isActive: boolean
): AccessibleTabPanelProps {
  return {
    role: 'tabpanel',
    'aria-labelledby': tabId,
    tabIndex: 0,
    hidden: !isActive,
  };
}

/**
 * Props for accessible images
 */
export function getImageProps(
  alt: string,
  isDecorative: boolean = false
): { alt: string; role?: 'presentation' } {
  if (isDecorative) {
    return { alt: '', role: 'presentation' };
  }
  return { alt };
}

/**
 * Props for accessible loading states
 */
export interface AccessibleLoadingProps {
  'aria-busy': boolean;
  'aria-live': 'polite' | 'assertive';
  role?: 'status' | 'alert';
}

export function getLoadingProps(
  isLoading: boolean,
  isUrgent: boolean = false
): AccessibleLoadingProps {
  return {
    'aria-busy': isLoading,
    'aria-live': isUrgent ? 'assertive' : 'polite',
    role: 'status',
  };
}

/**
 * Props for accessible errors
 */
export interface AccessibleErrorProps {
  role: 'alert';
  'aria-live': 'assertive';
}

export function getErrorProps(): AccessibleErrorProps {
  return {
    role: 'alert',
    'aria-live': 'assertive',
  };
}

/**
 * Props for accessible form fields
 */
export interface AccessibleInputProps {
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  'aria-required'?: boolean;
}

export function getInputProps(options: {
  hasError?: boolean;
  errorId?: string;
  helpTextId?: string;
  isRequired?: boolean;
}): AccessibleInputProps {
  const describedBy = [options.errorId, options.helpTextId]
    .filter(Boolean)
    .join(' ');

  return {
    ...(options.hasError && { 'aria-invalid': true }),
    ...(describedBy && { 'aria-describedby': describedBy }),
    ...(options.isRequired && { 'aria-required': true }),
  };
}

/**
 * Props for accessible dialogs/modals
 */
export interface AccessibleDialogProps {
  role: 'dialog' | 'alertdialog';
  'aria-modal': boolean;
  'aria-labelledby': string;
  'aria-describedby'?: string;
}

export function getDialogProps(options: {
  titleId: string;
  descriptionId?: string;
  isAlert?: boolean;
}): AccessibleDialogProps {
  return {
    role: options.isAlert ? 'alertdialog' : 'dialog',
    'aria-modal': true,
    'aria-labelledby': options.titleId,
    ...(options.descriptionId && { 'aria-describedby': options.descriptionId }),
  };
}

/**
 * Props for accessible progress indicators
 */
export interface AccessibleProgressProps {
  role: 'progressbar';
  'aria-valuenow': number;
  'aria-valuemin': number;
  'aria-valuemax': number;
  'aria-valuetext'?: string;
  'aria-label': string;
}

export function getProgressProps(options: {
  value: number;
  max?: number;
  label: string;
  valueText?: string;
}): AccessibleProgressProps {
  return {
    role: 'progressbar',
    'aria-valuenow': options.value,
    'aria-valuemin': 0,
    'aria-valuemax': options.max ?? 100,
    'aria-label': options.label,
    ...(options.valueText && { 'aria-valuetext': options.valueText }),
  };
}

/**
 * Keyboard navigation helpers
 */
export const KeyboardKeys = {
  ENTER: 'Enter',
  SPACE: ' ',
  ESCAPE: 'Escape',
  TAB: 'Tab',
  ARROW_UP: 'ArrowUp',
  ARROW_DOWN: 'ArrowDown',
  ARROW_LEFT: 'ArrowLeft',
  ARROW_RIGHT: 'ArrowRight',
  HOME: 'Home',
  END: 'End',
} as const;

export function isActivationKey(key: string): boolean {
  return key === KeyboardKeys.ENTER || key === KeyboardKeys.SPACE;
}

export function isNavigationKey(key: string): boolean {
  return [
    KeyboardKeys.ARROW_UP,
    KeyboardKeys.ARROW_DOWN,
    KeyboardKeys.ARROW_LEFT,
    KeyboardKeys.ARROW_RIGHT,
    KeyboardKeys.HOME,
    KeyboardKeys.END,
  ].includes(key as any);
}

/**
 * Screen reader only text (visually hidden)
 */
export const srOnlyStyle: React.CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

/**
 * CSS class for screen reader only content
 * Use with: className="sr-only"
 */
export const SR_ONLY_CLASS = 'sr-only';

/**
 * Announce message to screen readers
 */
export function announceToScreenReader(
  message: string,
  priority: 'polite' | 'assertive' = 'polite'
): void {
  const announcement = document.createElement('div');
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', priority);
  announcement.setAttribute('aria-atomic', 'true');
  announcement.className = SR_ONLY_CLASS;
  announcement.textContent = message;

  document.body.appendChild(announcement);

  // Remove after announcement is read
  setTimeout(() => {
    document.body.removeChild(announcement);
  }, 1000);
}

/**
 * Focus management utilities
 */
export function focusFirstFocusable(container: HTMLElement): void {
  const focusable = container.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (focusable.length > 0) {
    focusable[0].focus();
  }
}

export function trapFocus(container: HTMLElement): () => void {
  const focusable = container.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const firstFocusable = focusable[0];
  const lastFocusable = focusable[focusable.length - 1];

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;

    if (e.shiftKey) {
      if (document.activeElement === firstFocusable) {
        e.preventDefault();
        lastFocusable?.focus();
      }
    } else {
      if (document.activeElement === lastFocusable) {
        e.preventDefault();
        firstFocusable?.focus();
      }
    }
  };

  container.addEventListener('keydown', handleKeyDown);

  return () => {
    container.removeEventListener('keydown', handleKeyDown);
  };
}
