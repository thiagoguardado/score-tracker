import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppProvider } from "./store";
import HomePage from "./pages/HomePage";
import NewGamePage from "./pages/NewGamePage";
import GamePage from "./pages/GamePage";
import { I18nProvider } from "./i18n";

export default function App() {
  return (
    <I18nProvider>
      <AppProvider>
        <HashRouter>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/games/new" element={<NewGamePage />} />
            <Route path="/games/:gameId" element={<GamePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      </AppProvider>
    </I18nProvider>
  );
}
