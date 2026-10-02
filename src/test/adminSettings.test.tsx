import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AdminSettings from "@/pages/admin/AdminSettings";

const { fromMock, upsertMock, maybeSingleMock, toastMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  upsertMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("@/lib/supabaseClient", () => ({
  supabase: { from: fromMock },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

describe("Admin payment mode toggle", () => {
  beforeEach(() => {
    toastMock.mockReset();
    upsertMock.mockReset();
    maybeSingleMock.mockReset();
    maybeSingleMock.mockResolvedValue({
      data: { value: "live", updated_at: "2026-09-28T12:00:00.000Z" },
      error: null,
    });
    upsertMock.mockResolvedValue({ error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === "email_templates") {
        return {
          select: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }
      expect(table).toBe("app_settings");
      return {
        select: () => ({
          eq: () => ({ maybeSingle: maybeSingleMock }),
        }),
        upsert: upsertMock,
      };
    });
  });

  it("shows Live and writes Test after confirmation", async () => {
    render(
      <MemoryRouter>
        <AdminSettings />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("payment-mode-current")).toHaveTextContent("Live");
    expect(screen.getByText(/Test = Stripe Sandbox \+ Shippo test rates/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText("Switch payments to Test?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use Test" }));

    await waitFor(() => {
      expect(upsertMock).toHaveBeenCalledWith(
        { key: "payment_mode", value: "test" },
        { onConflict: "key" },
      );
    });
    expect(screen.getByTestId("payment-mode-current")).toHaveTextContent("Test");
  });
});
