import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Flags } from "./flags";
import type { Flag } from "@/lib/types";

describe("<Flags />", () => {
  const red: Flag[] = [
    { label: "Too many mirror selfies", detail: "Swap some out.", severity: "high" },
  ];
  const green: Flag[] = [{ label: "Travel", detail: "Great signal.", severity: "high" }];

  it("renders both red and green flags", () => {
    render(<Flags red={red} green={green} />);
    expect(screen.getByText("Too many mirror selfies")).toBeInTheDocument();
    expect(screen.getByText("Travel")).toBeInTheDocument();
  });

  it("shows an encouraging empty state when there are no red flags", () => {
    render(<Flags red={[]} green={green} />);
    expect(screen.getByText(/None detected/i)).toBeInTheDocument();
  });
});
