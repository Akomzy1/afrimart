import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

export type StorefrontPage = { url: URL; status: number; body: string; pages?: string };
export type PageReader = (url: URL, signal: AbortSignal, queryBody?: string) => Promise<StorefrontPage>;

export function publicAddress(address: string) {
  const ip = ipaddr.parse(address);
  if (ip.range() !== "unicast") return false;
  return ip.kind() === "ipv4" || (ip as ipaddr.IPv6).match(ipaddr.IPv6.parse("2000::"), 3);
}

export const readPublicPage: PageReader = async (start, signal, queryBody) => {
  let url = start;
  for (let redirects = 0; redirects <= 3; redirects++) {
    signal.throwIfAborted();
    if (!["http:", "https:"].includes(url.protocol) || url.port || url.username || url.password)
      throw Error("Use a public storefront address on a standard web port.");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (!addresses.length || !addresses.every(a => publicAddress(a.address))) throw Error("Use a publicly accessible storefront address.");
    // Connect to the checked address. Keep the original host for HTTP and TLS.
    const options = { hostname: addresses[0]!.address, servername: isIP(host) ? undefined : host,
      path: url.pathname + url.search, headers: { Host: url.host, Accept: "text/html, application/json", "Accept-Encoding": "identity" },
      signal, agent: false as const };
    const transport = url.protocol === "https:" ? https : http;
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const request = transport.request({ ...options, method: queryBody ? "POST" : "GET" }, resolve);
      request.on("error", reject);
      if (queryBody) request.setHeader("Content-Type", "application/json");
      request.end(queryBody);
    });
    const status = response.statusCode ?? 0;
    if ([301,302,303,307,308].includes(status) && response.headers.location) {
      response.destroy();
      if (queryBody) throw Error("The storefront API redirected its catalogue query.");
      url = new URL(response.headers.location, url);
      continue;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response) {
      size += chunk.length;
      if (size > 2_000_000) { response.destroy(); throw Error("A storefront page exceeded the import size limit."); }
      chunks.push(chunk);
    }
    const pages = response.headers["x-wp-totalpages"];
    return { url, status, body: Buffer.concat(chunks).toString("utf8"), pages: typeof pages === "string" ? pages : undefined };
  }
  throw Error("The storefront redirected too many times.");
};
