import Fastify from "fastify";
import cors from "@fastify/cors";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { appRouter } from "./router.js";
import { createContext } from "./trpc.js";
import { registerPhotoRoute } from "./storage/route.js";
import { assertPhotoSigningConfigured } from "./storage/access.js";
import { assertPhotoStorageReady } from "./storage/store.js";

// Photos arrive as base64 inside a tRPC mutation; 8MB of image is about 11MB encoded.
const server = Fastify({ logger: true, bodyLimit: 12 * 1024 * 1024 });

await server.register(cors, {
  // The local apps, plus any deployed origins named in CORS_ORIGINS (comma-separated).
  origin: [/^http:\/\/localhost:\d+$/, ...(process.env.CORS_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean) ?? [])],
  credentials: true,
});

await server.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: { router: appRouter, createContext },
});

registerPhotoRoute(server);

await assertPhotoStorageReady();
assertPhotoSigningConfigured();

const port = Number(process.env.PORT ?? 4000);

server
  .listen({ port, host: "0.0.0.0" })
  .then(() => server.log.info(`AfriMart backend listening on :${port}`))
  .catch((err) => {
    server.log.error(err);
    process.exit(1);
  });
