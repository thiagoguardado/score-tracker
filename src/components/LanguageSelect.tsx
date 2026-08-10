import { useI18n, type Locale } from "../i18n";

export function LanguageSelect() {
  const { locale, messages, setLocale } = useI18n();
  return (
    <label className="language-select">
      <span>{messages.common.language}</span>
      <select aria-label={messages.common.language} value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
        <option value="en">EN</option>
        <option value="pt-BR">PT</option>
      </select>
    </label>
  );
}

export default LanguageSelect;
