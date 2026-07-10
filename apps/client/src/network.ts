import type { ClientMessage, ServerMessage } from "@knockout/shared";

export class GameSocket {
  private socket?: WebSocket;
  private reconnectTimer?: number;
  private manualClose = false;
  private onMessage?: (message: ServerMessage) => void;
  private onState?: (connected: boolean) => void;
  private url = "";
  private reconnectAttempts = 0;
  connect(
    onMessage: (message: ServerMessage) => void,
    onState: (connected: boolean) => void,
  ): void {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    this.url =
      import.meta.env.VITE_SERVER_URL ?? `${protocol}//${location.host}/ws`;
    this.onMessage = onMessage;
    this.onState = onState;
    this.manualClose = false;
    this.open();
  }
  private open(): void {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("open", () => {
      this.reconnectAttempts = 0;
      this.onState?.(true);
    });
    this.socket.addEventListener("close", () => {
      this.onState?.(false);
      if (!this.manualClose) {
        const delay =
          Math.min(15_000, 700 * 2 ** Math.min(5, this.reconnectAttempts++)) +
          Math.random() * 250;
        this.reconnectTimer = window.setTimeout(() => this.open(), delay);
      }
    });
    this.socket.addEventListener("message", (event) => {
      try {
        this.onMessage?.(JSON.parse(String(event.data)) as ServerMessage);
      } catch {
        /* malformed server data is ignored */
      }
    });
  }
  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify(message));
  }
  close(): void {
    this.manualClose = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }
}
