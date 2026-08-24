export class KnowledgeServiceError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409 | 502 | 503,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "KnowledgeServiceError";
  }
}
