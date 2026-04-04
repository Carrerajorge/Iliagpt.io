import http, { type Server } from "node:http";
import request, { type SuperAgentTest } from "supertest";

type ClosableServer = Pick<Server, "close" | "listen" | "once" | "off">;

export interface HttpTestClientHandle {
  client: SuperAgentTest;
  close: () => Promise<void>;
  server: ClosableServer;
}

async function listen(server: ClosableServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("error", onError);
      reject(error);
    };

    server.once("error", onError);
    server.listen(0, () => {
      server.off("error", onError);
      resolve();
    });
  });
}

async function closeServer(server: ClosableServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function createHttpTestClient(app: http.RequestListener): Promise<HttpTestClientHandle> {
  const server = http.createServer(app);
  await listen(server);

  return {
    client: request.agent(server),
    close: () => closeServer(server),
    server,
  };
}
