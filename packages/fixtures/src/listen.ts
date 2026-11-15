import type { Server, Socket } from "node:net";

/** A server that listens. */
export interface Listening {
  readonly host: string;
  readonly port: number;
  /** This function destroys each open connection and closes the server. */
  close(): Promise<void>;
}

/**
 * This function starts the server on the host and the port. The default port is a free port. The server keeps each
 * connection, so that `close` ends at once. A socket error of a connection does not stop the server.
 */
export async function listen(server: Server, host: string = "127.0.0.1", port: number = 0): Promise<Listening> {
  const sockets = new Set<Socket>();
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The server has no port.");
  return {
    host,
    port: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
