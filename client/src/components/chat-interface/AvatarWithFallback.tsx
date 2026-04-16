import React, { useState } from "react";

interface AvatarWithFallbackProps {
  src: string;
  alt: string;
  fallback: React.ReactNode;
  className?: string;
}

export function AvatarWithFallback({
  src,
  alt,
  fallback,
  className = "w-20 h-20 rounded-2xl"
}: AvatarWithFallbackProps) {
  const [hasError, setHasError] = useState(false);

  const containerClasses = `${className} bg-gradient-to-br from-primary via-primary/80 to-primary/60 flex items-center justify-center shadow-2xl shadow-primary/30`;

  if (hasError) {
    return (
      <div className={containerClasses} role="img" aria-label={alt}>
        {fallback}
      </div>
    );
  }

  return (
    <div className={containerClasses}>
      <img
        src={src}
        alt={alt}
        className="w-full h-full rounded-2xl object-cover"
        onError={() => setHasError(true)}
      />
    </div>
  );
}
