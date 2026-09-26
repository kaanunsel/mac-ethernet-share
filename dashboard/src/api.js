let token;
async function session() {
  const access = new URLSearchParams(location.hash.slice(1)).get("access");
  const response = await fetch("/api/session", {
    headers: access ? { "X-Dashboard-Access": access } : {},
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Could not authenticate this browser.");
  token = result.token;
  if (access) history.replaceState(null, "", location.pathname + "#overview");
}
export async function request(path, body, retry = true) {
  if (!token) await session();
  const response = await fetch("/api/" + path, {
    method: body ? "POST" : "GET",
    headers: {
      "X-Dashboard-Token": token,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 403 && retry) {
    token = null;
    await session();
    return request(path, body, false);
  }
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Could not connect to the local service.");
  return result;
}
