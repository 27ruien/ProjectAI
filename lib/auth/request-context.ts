export type RequestAuditContext = {
  ipAddress: string | null;
  userAgent: string | null;
};

export function getRequestAuditContext(
  headers: Headers,
): RequestAuditContext {
  // The Staging reverse proxy overwrites x-real-ip. Raw X-Forwarded-For is
  // deliberately ignored because a directly supplied value is spoofable.
  const ipAddress = headers.get("x-real-ip")?.trim().slice(0, 64) || null;
  const userAgent = headers.get("user-agent")?.trim().slice(0, 1_000) || null;
  return { ipAddress, userAgent };
}
