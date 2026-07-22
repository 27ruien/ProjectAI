export class ProjectManagementError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409 | 422 | 503,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProjectManagementError";
  }
}
