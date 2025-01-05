import { onMounted, onUnmounted } from "vue";

export function useColorScheme() {
  const setTheme = (isDark: boolean) => {
    if (isDark) {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.classList.add("light");
    }
  };

  const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
  const setColorScheme = (e: MediaQueryListEvent) => setTheme(e.matches);

  onMounted(() => {
    setTheme(colorScheme.matches);
    colorScheme.addEventListener("change", setColorScheme);
  });
  onUnmounted(() => {
    colorScheme.removeEventListener("change", setColorScheme);
  });
}
