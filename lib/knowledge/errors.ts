export class KnowledgeManagementError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409,
    public readonly code:
      | "INVALID_REQUEST"
      | "RESOURCE_NOT_FOUND"
      | "FORBIDDEN"
      | "LAST_ADMIN_PROTECTED"
      | "SOURCE_CONFLICT"
      | "DUPLICATE_RESOURCE",
    message: string,
  ) {
    super(message);
    this.name = "KnowledgeManagementError";
  }
}
