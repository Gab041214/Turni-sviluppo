// Tema chiaro/scuro. La preferenza ("system" = segue il dispositivo) è salvata in localStorage;
// la classe "dark" sull'elemento <html> attiva i colori scuri definiti in styles.css.
import { useCallback, useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";

export const THEME_KEY = "orari.theme";
// Colore della barra del browser/di sistema (meta theme-color) nei due temi.
const THEME_COLOR = { light: "#D8D8DE", dark: "#020618" } as const;

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* ignore */
  }
  return "system";
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(pref: ThemePref): void {
  const dark = pref === "dark" || (pref === "system" && systemPrefersDark());
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? THEME_COLOR.dark : THEME_COLOR.light);
}

/**
 * Script eseguito nell'<head> prima del primo disegno della pagina: applica subito il tema
 * salvato, così all'apertura non c'è il lampo di tema chiaro. Deve restare allineato a applyTheme.
 */
export const themeInitScript = `(function(){try{var p=localStorage.getItem("${THEME_KEY}");var d=p==="dark"||(p!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;if(d)r.classList.add("dark");r.style.colorScheme=d?"dark":"light";var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",d?"${THEME_COLOR.dark}":"${THEME_COLOR.light}");}catch(e){}})();`;

function resolveDark(pref: ThemePref): boolean {
  return pref === "dark" || (pref === "system" && systemPrefersDark());
}

/**
 * Preferenza corrente, funzione per cambiarla e tema effettivo in questo momento (true = scuro,
 * anche quando la preferenza è "system" e dipende dal dispositivo). Con "system" segue anche i
 * cambi del dispositivo.
 */
export function useThemePref(): [ThemePref, (p: ThemePref) => void, boolean] {
  const [pref, setPref] = useState<ThemePref>("system");
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const p = readThemePref();
    setPref(p);
    setIsDark(resolveDark(p));
  }, []);

  useEffect(() => {
    setIsDark(resolveDark(pref));
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      applyTheme("system");
      setIsDark(mq.matches);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  const update = useCallback((p: ThemePref) => {
    setPref(p);
    setIsDark(resolveDark(p));
    try {
      if (p === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, p);
    } catch {
      /* ignore */
    }
    applyTheme(p);
  }, []);

  return [pref, update, isDark];
}
