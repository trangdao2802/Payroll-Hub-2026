import { useState, useEffect } from "react";
import { Palette } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { ThemePreviewCard } from "./ThemePreviewCard";

export function ThemeSwitcher() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState(() => {
    if (typeof window !== "undefined") {
      return (
        document.documentElement.getAttribute("data-theme") ||
        localStorage.getItem("app-theme") ||
        "opal-garden"
      );
    }
    return "opal-garden";
  });

  useEffect(() => {
    const checkTheme = () => {
      const theme =
        document.documentElement.getAttribute("data-theme") ||
        localStorage.getItem("app-theme") ||
        "opal-garden";
      setCurrentTheme(theme);
    };

    window.addEventListener("storage", checkTheme);
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      window.removeEventListener("storage", checkTheme);
      observer.disconnect();
    };
  }, []);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/80 bg-card hover:bg-muted/80 text-foreground shadow-2xs transition-all outline-none active:scale-[0.98] cursor-pointer"
          title={`Xem trước chủ đề bảng (${currentTheme})`}
          aria-label="Chủ đề giao diện"
        >
          <Palette className="w-4 h-4 text-accent" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[420px] max-w-[95vw] p-0 border border-border shadow-2xl rounded-xl z-[9999]"
      >
        <ThemePreviewCard
          initialPresetId={currentTheme}
          onClose={() => setIsOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

export default ThemeSwitcher;
