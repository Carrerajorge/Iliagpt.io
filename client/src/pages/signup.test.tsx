import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import SignupPage from "./signup";

const mockSetLocation = vi.fn();
const apiFetchMock = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/signup", mockSetLocation],
}));

vi.mock("@/lib/apiClient", () => ({
  apiFetch: (...args: any[]) => apiFetchMock(...args),
}));

vi.mock("@/contexts/PlatformSettingsContext", () => ({
  usePlatformSettings: () => ({
    settings: {
      allow_registration: true,
      support_email: "",
    },
    isLoading: false,
  }),
}));

describe("SignupPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers the account and redirects to login with the new email", async () => {
    apiFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(<SignupPage />);

    fireEvent.change(screen.getByTestId("input-signup-email-initial"), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByTestId("button-signup-continue"));

    fireEvent.change(screen.getByTestId("input-signup-password"), {
      target: { value: "SecurePass1" },
    });
    fireEvent.change(screen.getByTestId("input-signup-confirm-password"), {
      target: { value: "SecurePass1" },
    });

    fireEvent.click(screen.getByTestId("button-create-account"));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/auth/register",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            email: "user@example.com",
            password: "SecurePass1",
          }),
        }),
      );
    });

    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith("/login?email=user%40example.com&registered=1");
    });
  });

  it("shows the backend error when registration fails", async () => {
    apiFetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ message: "El usuario ya existe" }),
    });

    render(<SignupPage />);

    fireEvent.change(screen.getByTestId("input-signup-email-initial"), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByTestId("button-signup-continue"));

    fireEvent.change(screen.getByTestId("input-signup-password"), {
      target: { value: "SecurePass1" },
    });
    fireEvent.change(screen.getByTestId("input-signup-confirm-password"), {
      target: { value: "SecurePass1" },
    });

    fireEvent.click(screen.getByTestId("button-create-account"));

    await waitFor(() => {
      expect(screen.getByTestId("text-signup-error")).toHaveTextContent("El usuario ya existe");
    });
  });
});
