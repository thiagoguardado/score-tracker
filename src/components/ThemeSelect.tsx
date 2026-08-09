import { useI18n } from "../i18n";
import { useTheme, type ThemePreference } from "../theme";

export function ThemeSelect({ onDark = false }: { onDark?: boolean }) {
  const { messages } = useI18n();
  const { theme, setTheme } = useTheme();
  return (
    <label className={`theme-select ${onDark ? "on-dark" : ""}`}>
      <span>{messages.common.theme}</span>
      <select aria-label={messages.common.theme} value={theme} onChange={(event) => setTheme(event.target.value as ThemePreference)}>
        <option value="system">{messages.common.system}</option>
        <option value="light">{messages.common.light}</option>
        <option value="dark">{messages.common.dark}</option>
      </select>
    </label>
  );
}

export default ThemeSelect;
