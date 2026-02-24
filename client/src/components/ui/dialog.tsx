/**
 * Dialog Component with Full Accessibility Support
 * 
 * This component is built on Radix UI Dialog which provides comprehensive
 * WAI-ARIA dialog (modal) pattern implementation out of the box.
 * 
 * ## Accessibility Features (provided by Radix UI):
 * 
 * ### Focus Management
 * - **Focus Trap**: When the dialog opens, focus is trapped within it.
 *   Users cannot tab out of the dialog until it is closed.
 * - **Initial Focus**: Focus automatically moves to the first focusable element.
 * - **Focus Restoration**: When closed, focus returns to the trigger element.
 * 
 * ### Keyboard Navigation
 * - **Escape**: Closes the dialog (built-in behavior).
 * - **Tab**: Cycles through focusable elements within the dialog.
 * - **Shift+Tab**: Cycles backwards through focusable elements.
 * 
 * ### ARIA Attributes (automatically applied by Radix):
 * - `role="dialog"` on DialogContent
 * - `aria-modal="true"` on DialogContent
 * - `aria-labelledby` linking to DialogTitle
 * - `aria-describedby` linking to DialogDescription
 * 
 * ### Screen Reader Support
 * - Dialog title and description are announced when opened.
 * - Close button has "Close" as screen reader text.
 * 
 * @see https://www.radix-ui.com/primitives/docs/components/dialog
 * @see https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
 */

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Root component that manages dialog state.
 * Controls open/closed state and provides context to child components.
 */
const Dialog = DialogPrimitive.Root

/**
 * Button that triggers the dialog to open.
 * Focus returns to this element when the dialog closes.
 */
const DialogTrigger = DialogPrimitive.Trigger

/**
 * Portal for rendering dialog outside the DOM hierarchy.
 * Ensures proper stacking context and accessibility.
 */
const DialogPortal = DialogPrimitive.Portal

/**
 * Accessible close button component.
 * Can be used to create custom close buttons within the dialog.
 */
const DialogClose = DialogPrimitive.Close

/**
 * Semi-transparent overlay behind the dialog.
 * Clicking the overlay closes the dialog by default.
 * 
 * @accessibility
 * - Provides visual indication that the dialog is modal
 * - Dims background content to focus user attention
 */
const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-testid="dialog-overlay"
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

/**
 * Main dialog content container.
 * 
 * @accessibility
 * - Automatically receives `role="dialog"` and `aria-modal="true"`
 * - Focus is trapped within this element when open
 * - Escape key closes the dialog
 * - Links to DialogTitle via `aria-labelledby`
 * - Links to DialogDescription via `aria-describedby`
 */
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      data-testid="dialog-content"
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        data-testid="dialog-close-button"
        className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
      >
        <X className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

/**
 * Container for dialog header content (title and description).
 * Provides consistent spacing and alignment.
 */
const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

/**
 * Container for dialog footer content (action buttons).
 * Provides consistent spacing and responsive layout.
 */
const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

/**
 * Dialog title component.
 * 
 * @accessibility
 * - Automatically linked to DialogContent via `aria-labelledby`
 * - Announced by screen readers when dialog opens
 * - Required for proper accessibility - every dialog should have a title
 */
const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    data-testid="dialog-title"
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

/**
 * Dialog description component.
 * 
 * @accessibility
 * - Automatically linked to DialogContent via `aria-describedby`
 * - Provides additional context announced by screen readers
 * - Optional but recommended for dialogs with complex content
 */
const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    data-testid="dialog-description"
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
