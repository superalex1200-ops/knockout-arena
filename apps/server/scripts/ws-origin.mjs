export function websocketOrigin(address) {
  const url = new URL(address);
  if (url.protocol !== "ws:" && url.protocol !== "wss:")
    throw new Error(`Unsupported WebSocket protocol: ${url.protocol}`);
  return `${url.protocol === "wss:" ? "https:" : "http:"}//${url.host}`;
}

export function websocketOptions(address, origin = websocketOrigin(address)) {
  return { origin };
}
