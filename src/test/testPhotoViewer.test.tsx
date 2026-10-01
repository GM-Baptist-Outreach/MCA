import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabaseClient", () => ({ supabase: { from: vi.fn(), storage: { from: vi.fn() } } }));

import { TestPhotoViewer } from "@/pages/admin/AdminFamilyDetail";

const urls = [
  "https://x.test/a.jpg?token=1",
  "https://x.test/b.png?token=2",
  "https://x.test/c.HEIC?token=3",
];

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [index, setIndex] = useState(0);
  return <TestPhotoViewer urls={urls} index={index} onIndexChange={setIndex} onClose={onClose} />;
}

describe("Test photo viewer", () => {
  it("navigates with arrows, keyboard, wraps, and keeps the HEIC fallback", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    expect(screen.getByTestId("test-photo-counter").textContent).toBe("1 of 3");
    expect(screen.getByRole("img").getAttribute("src")).toBe(urls[0]);

    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(screen.getByTestId("test-photo-counter").textContent).toBe("2 of 3");
    expect(screen.getByRole("img").getAttribute("src")).toBe(urls[1]);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("test-photo-counter").textContent).toBe("3 of 3");
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("link", { name: "HEIC photo (open)" }).getAttribute("href")).toBe(urls[2]);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("test-photo-counter").textContent).toBe("1 of 3");

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByTestId("test-photo-counter").textContent).toBe("3 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Previous photo" }));
    expect(screen.getByTestId("test-photo-counter").textContent).toBe("2 of 3");
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides arrows for a single photo", () => {
    render(<TestPhotoViewer urls={[urls[0]]} index={0} onIndexChange={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "Next photo" })).toBeNull();
    expect(screen.getByTestId("test-photo-counter").textContent).toBe("1 of 1");
  });
});
