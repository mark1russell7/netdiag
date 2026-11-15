import { createServer } from "node:https";
import type { AddressInfo } from "node:net";

// The HTTPS host of the kernel lab: the target and the reference host. The target starts it on a stock Node image with
// no packages, so this module imports only `node:` modules. The key and the certificate come as arguments in base64,
// because a sibling of the harness gets no files.
//
//   node https.ts <port> <key in base64> <certificate in base64>

/** The text that the HTTPS host writes when it listens. The harness waits for it. */
export const HTTPS_READY = "netdiag https ready";

/** The arguments of the HTTPS host: its port, and its key and certificate as PEM text. */
export interface HttpsArgs {
  readonly port: number;
  readonly key: string;
  readonly cert: string;
}

/** A started HTTPS host. */
export interface HttpsHost {
  readonly port: number;
  close(): Promise<void>;
}

const base64 = (text: string): string => Buffer.from(text, "utf8").toString("base64");
const text = (encoded: string): string => Buffer.from(encoded, "base64").toString("utf8");

/** This function gives the arguments of the HTTPS host. */
export function httpsArgs(args: HttpsArgs): string[] {
  return [String(args.port), base64(args.key), base64(args.cert)];
}

/** This function reads the arguments of the HTTPS host. It throws a `RangeError` for an argument that is not valid. */
export function parseHttpsArgs(argv: readonly string[]): HttpsArgs {
  const [port, key, cert] = argv;
  const number = Number(port);
  if (!Number.isInteger(number) || number < 0 || number > 65_535) throw new RangeError(`The port "${port ?? ""}" is not a TCP port.`);
  if (key === undefined || cert === undefined) throw new RangeError("The HTTPS host needs a key and a certificate in base64.");
  return { port: number, key: text(key), cert: text(cert) };
}

/** This function starts the HTTPS host on all addresses, or on `host`. Each request gets the status 200 and a short text. */
export function startHttps(args: HttpsArgs, host = "0.0.0.0"): Promise<HttpsHost> {
  const server = createServer({ key: args.key, cert: args.cert }, (_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("netdiag kernel lab\n");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(args.port, host, () => {
      server.off("error", reject);
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

if (import.meta.main) {
  const started = await startHttps(parseHttpsArgs(process.argv.slice(2)));
  process.stdout.write(`${HTTPS_READY} on the port ${started.port}\n`);
}
