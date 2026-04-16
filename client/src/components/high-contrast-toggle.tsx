import { memo, useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Eye, EyeOff, Sun, Moon, Contrast } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

type ThemeMode = "light" | "dark" | "system";

interface AccessibilitySettings {
  highContrast: boolean;
  reducedMotion: boolean;
  largeText: boolean;
  theme: ThemeMode;
}

const STORAGE_KEY = "iliagpt_accessibility";

export function useAccessibilitySettings() {
  const [settings, setSettings] = useState<AccessibilitySettings>(() => {
    if (typeof window === "undefined") {
      return {
        highContrast: false,
        reducedMotion: false,
        largeText: false,
        theme: "system",
      };
    }
    
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // Ignore parse errors
      }
    }
    
    return {
      highContrast: false,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      largeText: false,
      theme: "system",
    };
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));

    const root = document.documentElement;

    if (settings.highContrast) {
      root.classList.add("high-contrast");
    } else {
      root.classList.remove("high-contrast");
    }

    if (settings.reducedMotion) {
      root.classList.add("reduce-motion");
    } else {
      root.classList.remove("reduce-motion");
    }

    if (settings.largeText) {
      root.classList.add("large-text");
    } else {
      root.classList.remove("large-text");
    }
  }, [settings]);

  const updateSetting = useCallback(<K extends keyof AccessibilitySettings>(
    key: K,
    value: AccessibilitySettings[K]
  ) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  return {
    settings,
    updateSetting,
    toggleHighContrast: () => updateSetting("highContrast", !settings.highContrast),
    toggleReducedMotion: () => updateSetting("reducedMotion", !settings.reducedMotion),
    toggleLargeText: () => updateSetting("largeText", !settings.largeText),
    setTheme: (theme: ThemeMode) => updateSetting("theme", theme),
  };
}

interface AccessibilityMenuProps {
  className?: string;
}

export const AccessibilityMenu = memo(function AccessibilityMenu({
  className,
}: AccessibilityMenuProps) {
  const {
    settings,
    toggleHighContrast,
    toggleReducedMotion,
    toggleLargeText,
    setTheme,
  } = useAccessibilitySettings();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-9 w-9", className)}
          title="Accesibilidad"
        >
          <Contrast className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Accesibilidad</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <div className="p-2 space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="high-contrast" className="text-sm">
              Alto contraste
            </Label>
            <Switch
              id="high-contrast"
              checked={settings.highContrast}
              onCheckedChange={toggleHighContrast}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="reduced-motion" className="text-sm">
              Reducir movimiento
            </Label>
            <Switch
              id="reduced-motion"
              checked={settings.reducedMotion}
              onCheckedChange={toggleReducedMotion}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="large-text" className="text-sm">
              Texto grande
            </Label>
            <Switch
              id="large-text"
              checked={settings.largeText}
              onCheckedChange={toggleLargeText}
            />
          </div>
        </div>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Tema</DropdownMenuLabel>

        <DropdownMenuItem onClick={() => setTheme("light")}>
          <Sun className="w-4 h-4 mr-2" />
          Claro
          {settings.theme === "light" && <span className="ml-auto">✓</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <Moon className="w-4 h-4 mr-2" />
          Oscuro
          {settings.theme === "dark" && <span className="ml-auto">✓</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <Contrast className="w-4 h-4 mr-2" />
          Sistema
          {settings.theme === "system" && <span className="ml-auto">✓</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

export default AccessibilityMenu;
