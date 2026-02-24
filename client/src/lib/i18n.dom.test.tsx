import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { __resetI18nForTests, initializeI18n, setLanguageAsync } from "@/lib/i18n";

function ViewA() {
  return (
    <section data-testid="view-a">
      <h1>Notificaciones</h1>
      <button type="button">Guardar</button>
      <input placeholder="Escribe tu mensaje" aria-label="Buscar" />
    </section>
  );
}

function ViewB() {
  return (
    <section data-testid="view-b">
      <h1>Idioma y región</h1>
      <p>Formato de fecha</p>
      <button type="button">Cancelar</button>
    </section>
  );
}

function ViewsHarness() {
  const [view, setView] = useState<"a" | "b">("a");

  return (
    <div>
      <button type="button" data-testid="switch-view" onClick={() => setView((prev) => (prev === "a" ? "b" : "a"))}>
        Cambiar vista
      </button>
      {view === "a" ? <ViewA /> : <ViewB />}
    </div>
  );
}

describe("i18n DOM auto-translation", () => {
  beforeEach(async () => {
    const storage = (globalThis as { localStorage?: { removeItem?: (key: string) => void; clear?: () => void } }).localStorage;
    storage?.removeItem?.("app_language");
    storage?.clear?.();
    __resetI18nForTests("es");
    await initializeI18n();
  });

  it("updates mounted and newly rendered views after language change", async () => {
    render(<ViewsHarness />);

    expect(screen.getByText("Notificaciones")).toBeInTheDocument();
    expect(screen.getByText("Guardar")).toBeInTheDocument();

    await setLanguageAsync("en", { persistProfile: false });

    await waitFor(() => {
      expect(screen.getByText("Notifications")).toBeInTheDocument();
      expect(screen.getByText("Save")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("Type your message")).toBeInTheDocument();
      expect(screen.getByLabelText("Search")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("switch-view"));

    await waitFor(() => {
      expect(screen.getByText("Language & region")).toBeInTheDocument();
      expect(screen.getByText("Date format")).toBeInTheDocument();
      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });
  });
});
