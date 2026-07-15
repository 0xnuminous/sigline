export function canonicalizeRpcEndpoint(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    if (url.username || url.password) return undefined;
    const hostname = url.hostname.replace(/\.+$/, "");
    if (!hostname) return undefined;
    url.hostname = hostname;

    while (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }

    url.searchParams.sort();
    // Fragments are never sent to an RPC server and cannot distinguish providers.
    url.hash = "";

    return url.href;
  } catch {
    return undefined;
  }
}

export function rpcEndpointOrigin(value: unknown): string | undefined {
  const canonical = canonicalizeRpcEndpoint(value);
  return canonical ? new URL(canonical).origin : undefined;
}

export function doRpcEndpointsShareOrigin(
  left: unknown,
  right: unknown,
): boolean {
  const leftOrigin = rpcEndpointOrigin(left);
  if (leftOrigin === undefined) return false;
  return leftOrigin === rpcEndpointOrigin(right);
}

export function areRpcEndpointsEquivalent(
  left: unknown,
  right: unknown,
): boolean {
  const canonicalLeft = canonicalizeRpcEndpoint(left);
  if (canonicalLeft === undefined) return false;

  const canonicalRight = canonicalizeRpcEndpoint(right);
  return canonicalRight !== undefined && canonicalLeft === canonicalRight;
}
