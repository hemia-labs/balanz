"use client";

import { useEffect, useLayoutEffect, useState } from "react";

type Theme = "light" | "dark";
const useThemeEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function getInitialTheme(): Theme {
  if (typeof document === "undefined") return "light";

  const storedTheme = localStorage.getItem("theme");
  if (storedTheme === "light" || storedTheme === "dark") return storedTheme;

  return document.documentElement.dataset.theme === "dark" ||
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeInitializer() {
  const [theme] = useState<Theme>(getInitialTheme);

  useThemeEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return null;
}
