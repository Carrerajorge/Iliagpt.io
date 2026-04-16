import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
    const [theme, setTheme] = useState<"light" | "dark">("dark");
    const [isAnimating, setIsAnimating] = useState(false);

    useEffect(() => {
        // Check for saved theme preference or system preference
        const savedTheme = localStorage.getItem("theme") as "light" | "dark" | null;
        const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

        const initialTheme = savedTheme || (systemPrefersDark ? "dark" : "light");
        setTheme(initialTheme);
        document.documentElement.classList.toggle("dark", initialTheme === "dark");
    }, []);

    const toggleTheme = () => {
        setIsAnimating(true);
        const newTheme = theme === "dark" ? "light" : "dark";

        // Animate the transition
        document.documentElement.style.setProperty("--theme-transition", "0.3s");

        setTheme(newTheme);
        localStorage.setItem("theme", newTheme);
        document.documentElement.classList.toggle("dark", newTheme === "dark");

        setTimeout(() => {
            setIsAnimating(false);
            document.documentElement.style.removeProperty("--theme-transition");
        }, 300);
    };

    return (
        <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className={`
        relative w-10 h-10 rounded-full overflow-hidden
        bg-gradient-to-br from-amber-100 to-amber-200 dark:from-slate-800 dark:to-slate-900
        border border-amber-300/50 dark:border-slate-600/50
        hover:scale-110 hover:shadow-lg hover:shadow-amber-500/20 dark:hover:shadow-purple-500/20
        transition-all duration-300 ease-out
        ${isAnimating ? "animate-spin-once" : ""}
      `}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
            {/* Sun Icon */}
            <Sun
                className={`
          absolute h-5 w-5 text-amber-600
          transition-all duration-300 ease-out
          ${theme === "dark"
                        ? "opacity-0 rotate-90 scale-0"
                        : "opacity-100 rotate-0 scale-100"
                    }
        `}
            />

            {/* Moon Icon */}
            <Moon
                className={`
          absolute h-5 w-5 text-purple-300
          transition-all duration-300 ease-out
          ${theme === "dark"
                        ? "opacity-100 rotate-0 scale-100"
                        : "opacity-0 -rotate-90 scale-0"
                    }
        `}
            />

            {/* Glow effect */}
            <div
                className={`
          absolute inset-0 rounded-full
          transition-opacity duration-300
          ${theme === "dark"
                        ? "bg-gradient-radial from-purple-500/20 to-transparent opacity-100"
                        : "bg-gradient-radial from-amber-500/20 to-transparent opacity-100"
                    }
        `}
            />
        </Button>
    );
}

// Compact version for header/navbar
export function ThemeToggleCompact() {
    const [theme, setTheme] = useState<"light" | "dark">("dark");

    useEffect(() => {
        const savedTheme = localStorage.getItem("theme") as "light" | "dark" | null;
        const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        const initialTheme = savedTheme || (systemPrefersDark ? "dark" : "light");
        setTheme(initialTheme);
        document.documentElement.classList.toggle("dark", initialTheme === "dark");
    }, []);

    const toggleTheme = () => {
        const newTheme = theme === "dark" ? "light" : "dark";
        setTheme(newTheme);
        localStorage.setItem("theme", newTheme);
        document.documentElement.classList.toggle("dark", newTheme === "dark");
    };

    return (
        <button
            onClick={toggleTheme}
            className="
        flex items-center gap-2 px-3 py-1.5 rounded-full
        bg-zinc-100 dark:bg-zinc-800
        border border-zinc-200 dark:border-zinc-700
        hover:bg-zinc-200 dark:hover:bg-zinc-700
        transition-all duration-200
        text-sm font-medium
      "
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
            <div className="relative w-4 h-4">
                <Sun
                    className={`absolute inset-0 h-4 w-4 text-amber-500 transition-all duration-200 ${theme === "dark" ? "opacity-0 scale-75" : "opacity-100 scale-100"
                        }`}
                />
                <Moon
                    className={`absolute inset-0 h-4 w-4 text-purple-400 transition-all duration-200 ${theme === "dark" ? "opacity-100 scale-100" : "opacity-0 scale-75"
                        }`}
                />
            </div>
            <span className="text-zinc-600 dark:text-zinc-300">
                {theme === "dark" ? "Dark" : "Light"}
            </span>
        </button>
    );
}
