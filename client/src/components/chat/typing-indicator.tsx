import { memo } from "react";

export const TypingIndicator = memo(function TypingIndicator({ username }: { username?: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground" role="status" aria-label={username ? `${username} is typing` : "Typing"}>
      <div className="flex gap-1">
        <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
        <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
        <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
      </div>
      {username && <span>{username} is typing...</span>}
    </div>
  );
});
