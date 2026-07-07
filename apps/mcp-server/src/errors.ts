/** Bad tool input from the caller — the HTTP bridge answers 400. */
export class ToolInputError extends Error {
  readonly name = "ToolInputError";
}

/** Server-side configuration is incomplete — the HTTP bridge answers 503. */
export class ToolConfigError extends Error {
  readonly name = "ToolConfigError";
}
