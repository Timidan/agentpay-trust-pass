/** Bad tool input from the caller — the HTTP bridge answers 400. */
export class ToolInputError extends Error {
  readonly name = "ToolInputError";

  constructor(
    message: string,
    readonly code: "invalid_input" | "invalid_subject" = "invalid_input"
  ) {
    super(message);
  }
}

/** Server-side configuration is incomplete — the HTTP bridge answers 503. */
export class ToolConfigError extends Error {
  readonly name = "ToolConfigError";

  constructor(
    message: string,
    readonly publicMessage =
      "AgentPay isn't configured to complete this request yet. The operator needs to finish the server setup."
  ) {
    super(message);
  }
}
