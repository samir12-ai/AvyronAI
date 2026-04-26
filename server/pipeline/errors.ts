export class PipelineValidationError extends Error {
  public readonly code: string;
  public readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "PipelineValidationError";
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return { error: this.name, code: this.code, message: this.message, details: this.details };
  }
}
