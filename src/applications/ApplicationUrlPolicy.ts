export interface ApplicationUrlCheck {
  allowed: boolean;
  reason: string;
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function validateApplicationNavigationUrl(url: string, expectedHost?: string): ApplicationUrlCheck {
  const parsed = parse(url);
  if (!parsed) return { allowed: false, reason: "Application URL is invalid; manual review is required." };
  if (parsed.protocol !== "https:") {
    const localTest = process.env.NODE_ENV === "test" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
    if (!localTest) return { allowed: false, reason: "Application navigation requires HTTPS outside an isolated localhost test fixture." };
  }
  if (parsed.username || parsed.password) return { allowed: false, reason: "Application URL contains embedded credentials and is blocked." };
  if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "0.0.0.0") {
    if (process.env.NODE_ENV !== "test") return { allowed: false, reason: "Loopback application targets are only permitted in isolated tests." };
  }
  if (expectedHost && parsed.hostname.toLowerCase() !== expectedHost.toLowerCase()) {
    return { allowed: false, reason: "Application navigation redirected to a different host; possible malicious redirect." };
  }
  return { allowed: true, reason: "Application URL passed navigation safety checks." };
}
