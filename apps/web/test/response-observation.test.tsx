import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ResponseObservation } from "../src/audit/sections/ResponseObservation";
import type { AuditFlow } from "../src/audit/useAuditFlow";

afterEach(cleanup);

it("shows an automatically recorded response as read-only completed evidence", () => {
  const flow = {
    settlementVerdict: "match",
    observation: {
      status: "success",
      error: null,
      data: {
        created: true,
        observation: {
          checkId: "check-1",
          observerVersion: "agentpay-web/0.1.0",
          status: 200,
          contentType: "application/json",
          bodyBytes: 3274,
          bodyHash: "a".repeat(64),
          observedAt: "2026-07-17T15:53:35.356Z",
          observationHash: "b".repeat(64)
        },
        receipt: {}
      }
    },
    recordObservation: () => undefined
  } as unknown as AuditFlow;

  render(<ResponseObservation flow={flow} />);

  expect(screen.getByText("recorded", { exact: true })).toBeTruthy();
  expect(screen.getByText("3,274 bytes", { exact: true })).toBeTruthy();
  expect(screen.getByText("application/json", { exact: true })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Record response" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Body hash" })).toBeNull();
});

it("keeps manual response entry available as an advanced fallback", () => {
  const flow = {
    settlementVerdict: "match",
    observation: { status: "idle", error: null, data: null },
    recordObservation: () => undefined
  } as unknown as AuditFlow;

  render(<ResponseObservation flow={flow} />);

  expect(screen.getByText("Record a response from another client")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Record response" })).toBeTruthy();
});
