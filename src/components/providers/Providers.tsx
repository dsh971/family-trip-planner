"use client";

import { TooltipProvider } from "@sumiui/react";
import { ThemeProvider } from "./ThemeProvider";
import { AppHeader } from "@/components/ui/AppHeader";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <ThemeProvider>
        <AppHeader />
        {children}
      </ThemeProvider>
    </TooltipProvider>
  );
}
