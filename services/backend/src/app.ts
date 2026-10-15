import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { appRouter } from "./router.js";
import { createContext } from "./trpc.js";
import { registerPhotoRoute } from "./storage/route.js";
import { corsOrigins } from "./auth/origins.js";

/**
 * The HTTP application, built apart from listening so that tests can drive the
 * real thing (cookies, CORS, the picture route) with `inject` and no port.
 */
export async function buildServer(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  // Photos arrive as base64 inside a tRPC mutation; 8MB of image is about 11MB encoded.
  const server = Fastify({ logger: opts.logger ?? true, bodyLimit: 12 * 1024 * 1024 });

  // Credentials are allowed only to the origins named by corsOrigins(): the local
  // apps, plus CORS_ORIGINS. A cookie is never readable by, or usable from, a page
  // anywhere else (see auth/origins.ts for the matching write check).
  await server.register(cors, { origin: corsOrigins(), credentials: true });

  await server.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: { router: appRouter, createContext },
  });

  registerPhotoRoute(server);
  return server;
}
