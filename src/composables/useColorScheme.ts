import { onMounted } from "vue";

export function useColorScheme() {
  // color mode
  onMounted(() => {
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const setTheme = (isDark: boolean) => {
      if (isDark) {
        document.documentElement.classList.add("dark");
        document.documentElement.classList.remove("light");
      } else {
        document.documentElement.classList.remove("dark");
        document.documentElement.classList.add("light");
      }
    };
    colorScheme.addEventListener("change", (e) => setTheme(e.matches));
    setTheme(colorScheme.matches);
  });
}
