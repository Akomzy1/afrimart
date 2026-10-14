import Fastify from "fastify";
import cors from "@fastify/cors";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { appRouter } from "./router.js";
import { createContext } from "./trpc.js";
import { PHOTO_KINDS, photoStore, type PhotoKind } from "./storage/photos.js";

// Photos arrive as base64 inside a tRPC mutation; 8MB of image is about 11MB encoded.
const server = Fastify({ logger: true, bodyLimit: 12 * 1024 * 1024 });

await server.register(cors, {
  origin: [/^http:\/\/localhost:\d+$/],
  credentials: true,
});

await server.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: { router: appRouter, createContext },
});

/**
 * Evidence photos (QC-2 packing, QC-3 claim). The name is 128 random bits, so a
 * link is a capability; both path parts are matched against fixed shapes before
 * touching the disk. Served as an image and nothing else (nosniff), and never
 * cached by a shared proxy.
 */
server.get<{ Params: { kind: string; name: string } }>("/photos/:kind/:name", async (req, reply) => {
  const kind = req.params.kind as PhotoKind;
  const bytes = PHOTO_KINDS.includes(kind) ? await photoStore.read(kind, req.params.name) : null;
  if (!bytes) return reply.code(404).send({ error: "Not found" });
  return reply
    .header("content-type", "image/jpeg")
    .header("x-content-type-options", "nosniff")
    .header("cache-control", "private, max-age=31536000, immutable")
    .header("cross-origin-resource-policy", "cross-origin")
    .send(bytes);
});

const port = Number(process.env.PORT ?? 4000);

server
  .listen({ port, host: "0.0.0.0" })
  .then(() => server.log.info(`AfriMart backend listening on :${port}`))
  .catch((err) => {
    server.log.error(err);
    process.exit(1);
  });
