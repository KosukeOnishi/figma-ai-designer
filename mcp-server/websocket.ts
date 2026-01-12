import { WebSocketServer, WebSocket } from 'ws';
import type { Message, RequestMessage, ResponseMessage } from '../shared/types';

const DEFAULT_PORT = 51847;

export class FigmaWebSocketServer {
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private pendingRequests: Map<string, {
    resolve: (value: ResponseMessage) => void;
    reject: (reason: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();
  private port: number;
  private connectionPromise: Promise<void> | null = null;
  private connectionResolve: (() => void) | null = null;

  constructor(port: number = DEFAULT_PORT) {
    this.port = port;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port: this.port });

        this.wss.on('listening', () => {
          console.error(`[MCP] WebSocket server listening on port ${this.port}`);
          resolve();
        });

        this.wss.on('connection', (ws: WebSocket) => {
          console.error('[MCP] Figma plugin connected');
          this.client = ws;

          if (this.connectionResolve) {
            this.connectionResolve();
            this.connectionResolve = null;
          }

          ws.on('message', (data: Buffer) => {
            try {
              const message = JSON.parse(data.toString()) as Message;
              this.handleMessage(message);
            } catch (error) {
              console.error('[MCP] Failed to parse message:', error);
            }
          });

          ws.on('close', () => {
            console.error('[MCP] Figma plugin disconnected');
            this.client = null;
            // Reject all pending requests
            for (const [id, pending] of this.pendingRequests) {
              clearTimeout(pending.timeout);
              pending.reject(new Error('Connection closed'));
              this.pendingRequests.delete(id);
            }
          });

          ws.on('error', (error) => {
            console.error('[MCP] WebSocket error:', error);
          });
        });

        this.wss.on('error', (error) => {
          console.error('[MCP] WebSocket server error:', error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleMessage(message: Message): void {
    if (message.type === 'result' || message.type === 'error' || message.type === 'pong') {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        pending.resolve(message as ResponseMessage);
        this.pendingRequests.delete(message.id);
      }
    } else if (message.type === 'connected') {
      console.error('[MCP] Plugin connected:', message);
    }
  }

  async send<T extends ResponseMessage>(request: RequestMessage, timeoutMs: number = 30000): Promise<T> {
    if (!this.client || this.client.readyState !== WebSocket.OPEN) {
      throw new Error('Figma plugin is not connected. Please open the AI Designer plugin in Figma.');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error('Request timed out'));
      }, timeoutMs);

      this.pendingRequests.set(request.id, {
        resolve: resolve as (value: ResponseMessage) => void,
        reject,
        timeout,
      });

      this.client!.send(JSON.stringify(request));
    });
  }

  isConnected(): boolean {
    return this.client !== null && this.client.readyState === WebSocket.OPEN;
  }

  async waitForConnection(timeoutMs: number = 60000): Promise<void> {
    if (this.isConnected()) {
      return;
    }

    if (!this.connectionPromise) {
      this.connectionPromise = new Promise((resolve, reject) => {
        this.connectionResolve = resolve;
        setTimeout(() => {
          if (!this.isConnected()) {
            reject(new Error('Waiting for Figma plugin connection timed out'));
          }
        }, timeoutMs);
      });
    }

    return this.connectionPromise;
  }

  stop(): void {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    this.client = null;
  }

  generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

// Singleton instance
let instance: FigmaWebSocketServer | null = null;

export function getWebSocketServer(port?: number): FigmaWebSocketServer {
  if (!instance) {
    instance = new FigmaWebSocketServer(port);
  }
  return instance;
}
