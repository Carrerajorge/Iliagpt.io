import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

function OpenClawLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle cx="24" cy="24" r="22" fill="url(#oc-bg)" />
      <path
        d="M24 8c-2 0-3.5 1-4 2.5L18 14c-1 0-2.5.5-3 2l-2 4c-.5 1.5 0 3 1 4l-1 3c-.5 2 .5 3.5 2 4l1 .5c.5 2 2 3.5 4 3.5h1l2 3c1 1.5 3 1.5 4 0l2-3h1c2 0 3.5-1.5 4-3.5l1-.5c1.5-.5 2.5-2 2-4l-1-3c1-1 1.5-2.5 1-4l-2-4c-.5-1.5-2-2-3-2l-2-3.5c-.5-1.5-2-2.5-4-2.5z"
        fill="url(#oc-body)"
        stroke="#c2410c"
        strokeWidth="0.5"
      />
      <ellipse cx="20" cy="18" rx="2.5" ry="3" fill="white" />
      <ellipse cx="28" cy="18" rx="2.5" ry="3" fill="white" />
      <circle cx="20.5" cy="17.5" r="1.2" fill="#1e293b" />
      <circle cx="28.5" cy="17.5" r="1.2" fill="#1e293b" />
      <path d="M15 14l-4-4M14 12l-5-1" stroke="#ea580c" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M33 14l4-4M34 12l5-1" stroke="#ea580c" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12 24l-4-1c-1 0-1.5 1-1 2l2 3c.5 1 1.5 1 2 0l2-2" stroke="#ea580c" strokeWidth="1.5" strokeLinecap="round" fill="#f97316" />
      <path d="M36 24l4-1c1 0 1.5 1 1 2l-2 3c-.5 1-1.5 1-2 0l-2-2" stroke="#ea580c" strokeWidth="1.5" strokeLinecap="round" fill="#f97316" />
      <path d="M21 34l-1 4c0 1 .5 1.5 1.5 1l2-2" stroke="#ea580c" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M24 34l0 4.5c0 .5.5 1 1 .5" stroke="#ea580c" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M27 34l1 4c0 1-.5 1.5-1.5 1l-2-2" stroke="#ea580c" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M20 26c0 0 2 2 4 2s4-2 4-2" stroke="#c2410c" strokeWidth="1" strokeLinecap="round" fill="none" />
      <defs>
        <radialGradient id="oc-bg" cx="24" cy="20" r="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fed7aa" />
          <stop offset="100%" stopColor="#fb923c" />
        </radialGradient>
        <linearGradient id="oc-body" x1="16" y1="8" x2="32" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f97316" />
          <stop offset="50%" stopColor="#ea580c" />
          <stop offset="100%" stopColor="#c2410c" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export { OpenClawLogo };

export function OpenClawPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] p-0 gap-0 overflow-hidden" data-testid="openclaw-panel">
        <DialogHeader className="sr-only">
          <DialogTitle>OpenClaw</DialogTitle>
          <DialogDescription>Panel de control de OpenClaw</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
