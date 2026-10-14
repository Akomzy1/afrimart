import type { FastifyInstance } from "fastify";
import { photoStore, type PhotoKind } from "./photos.js";
import { photoLinkIsValid } from "./access.js";

/**
 * Evidence photos (QC-2 packing, QC-3 claim, licence documents). Private: a
 * request is served only with a valid signature for exactly this file that has
 * not expired, which a procedure issues after checking the caller may see the
 * photo (access.ts). Anything else, including a real file with no or a bad
 * signature, is the same 404 as a file that does not exist, so the route
 * reveals nothing about what is stored. Both path parts are matched against
 * fixed shapes before touching the disk, served as an image and nothing else
 * (nosniff), and never cached: a link is short-lived, and the picture behind it
 * should not outlive it in a browser or proxy.
 */
export function registerPhotoRoute(server: FastifyInstance): void {
  server.get<{ Params: { kind: string; name: string }; Querystring: { exp?: string; sig?: string } }>(
    "/photos/:kind/:name",
    async (req, reply) => {
      const { kind, name } = req.params;
      const allowed = photoLinkIsValid(kind, name, req.query.exp, req.query.sig);
      const bytes = allowed ? await photoStore.read(kind as PhotoKind, name) : null;
      if (!bytes) return reply.code(404).header("cache-control", "no-store").send({ error: "Not found" });
      return reply
        .header("content-type", "image/jpeg")
        .header("x-content-type-options", "nosniff")
        .header("cache-control", "private, no-store")
        .header("cross-origin-resource-policy", "cross-origin")
        .send(bytes);
    },
  );
}
