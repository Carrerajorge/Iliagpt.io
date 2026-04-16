import * as React from "react";
import { cn } from "@/lib/utils";
import { ToggleSwitch } from "./toggle-switch";
import "./glass-effects.css";

const SOURCE_ITEM_TOKENS = {
  height: 44,
  padding: {
    x: 8,
    y: 8,
  },
  gap: 12,
  iconSize: 20,
  borderRadius: 6,
  fontSize: 14,
  lineHeight: 20,
} as const;

export interface SourceListItemProps {
  icon: React.ReactNode;
  label: string;
  truncateLabel?: boolean;
  variant: "toggle" | "connect";
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  onConnect?: () => void;
  disabled?: boolean;
  loading?: boolean;
  "data-testid"?: string;
}

export function SourceListItem({
  icon,
  label,
  truncateLabel = false,
  variant,
  checked = false,
  onCheckedChange,
  onConnect,
  disabled = false,
  loading = false,
  "data-testid": testId,
}: SourceListItemProps) {
  return (
    <div
      className={cn(
        "source-list-item-glass",
        "flex items-center justify-between",
        disabled && "opacity-50 pointer-events-none",
      )}
      style={{
        minHeight: SOURCE_ITEM_TOKENS.height,
        paddingLeft: SOURCE_ITEM_TOKENS.padding.x,
        paddingRight: SOURCE_ITEM_TOKENS.padding.x,
        paddingTop: SOURCE_ITEM_TOKENS.padding.y,
        paddingBottom: SOURCE_ITEM_TOKENS.padding.y,
        gap: SOURCE_ITEM_TOKENS.gap,
        borderRadius: SOURCE_ITEM_TOKENS.borderRadius,
      }}
      data-testid={testId}
    >
      <div 
        className="flex items-center relative z-10"
        style={{ gap: SOURCE_ITEM_TOKENS.gap }}
      >
        <div 
          className="flex items-center justify-center shrink-0"
          style={{ 
            width: SOURCE_ITEM_TOKENS.iconSize, 
            height: SOURCE_ITEM_TOKENS.iconSize 
          }}
        >
          {icon}
        </div>
        <span 
          className={cn(
            "font-medium text-foreground",
            truncateLabel && "truncate max-w-[100px]"
          )}
          style={{
            fontSize: SOURCE_ITEM_TOKENS.fontSize,
            lineHeight: `${SOURCE_ITEM_TOKENS.lineHeight}px`,
          }}
        >
          {label}
        </span>
      </div>

      {variant === "toggle" && onCheckedChange && (
        <div className="relative z-10">
          <ToggleSwitch
            checked={checked}
            onCheckedChange={onCheckedChange}
            disabled={disabled}
            loading={loading}
            data-testid={testId ? `${testId}-toggle` : undefined}
          />
        </div>
      )}

      {variant === "connect" && (
        <button
          type="button"
          onClick={onConnect}
          disabled={disabled || loading}
          className={cn(
            "connect-button-glass",
            "relative z-10",
          )}
          data-testid={testId ? `${testId}-connect` : undefined}
        >
          Conectar
        </button>
      )}
    </div>
  );
}
