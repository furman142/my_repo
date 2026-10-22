import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ApprovalSheet } from "../src/features/approvals/ApprovalSheet";
import { dictionaries } from "../src/lib/i18n";

const t = dictionaries.en;

function approval(expiresInS = 120) {
  return {
    request: {
      id: "r1", tool_name: "create_task", arguments: { title: "Buy flowers", due: null }, nonce: "n0nce-123",
      preview: "Create task “Buy flowers”", status: "pending",
      expires_at: new Date(Date.now() + expiresInS * 1000).toISOString(), conversation_id: "c",
    },
    title: "Create task",
    sideEffect: "write",
  };
}

describe("ApprovalSheet", () => {
  it("shows the exact preview and only approves on explicit click", () => {
    const onDecide = vi.fn();
    render(<ApprovalSheet approval={approval()} t={t} onDecide={onDecide} />);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Create task “Buy flowers”")).toBeInTheDocument();
    expect(onDecide).not.toHaveBeenCalled();
    // Default focus is on Deny (safe default), so pressing Enter cannot approve by accident.
    expect(document.activeElement?.textContent).toBe("Deny");
    fireEvent.click(screen.getByText("Approve"));
    expect(onDecide).toHaveBeenCalledWith(true);
  });

  it("can deny", () => {
    const onDecide = vi.fn();
    render(<ApprovalSheet approval={approval()} t={t} onDecide={onDecide} />);
    fireEvent.click(screen.getByText("Deny"));
    expect(onDecide).toHaveBeenCalledWith(false);
  });

  it("disables approve once expired", () => {
    render(<ApprovalSheet approval={approval(-5)} t={t} onDecide={() => undefined} />);
    expect(screen.getByText("Approve")).toBeDisabled();
  });
});
