import { describe, expect, it } from "vitest";
import { sanitizeUrl } from "../data/url";

describe("sanitizeUrl", () => {
  it("removes fragments, tracking, and sensitive values", () => {
    expect(
      sanitizeUrl("https://example.com/read?id=42&utm_source=newsletter&token=secret#section"),
    ).toBe("https://example.com/read?id=42");
  });

  it("fails closed for invalid input", () => {
    expect(sanitizeUrl("not a url")).toBe("");
  });
});
