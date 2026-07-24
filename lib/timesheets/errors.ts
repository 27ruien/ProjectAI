export class TimesheetError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409 | 422 | 503,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TimesheetError";
  }
}
