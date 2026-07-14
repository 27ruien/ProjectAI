export function normalizeApplicationCookieName(setCookieValue) {
  const cookieName = setCookieValue.split("=", 1)[0]?.trim() || "";
  return cookieName.replace(/^__(?:Secure|Host)-/i, "");
}
