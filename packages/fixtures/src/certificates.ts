import { isIP } from "node:net";
import { generate } from "selfsigned";

/** A key and a certificate, as PEM text. */
export interface Pems {
  readonly key: string;
  readonly cert: string;
}

/** The times of a certificate. The defaults are one minute before the call and one day after it. */
export interface Validity {
  readonly notBefore?: Date | undefined;
  readonly notAfter?: Date | undefined;
}

/** A root of trust for tests. It issues server certificates. */
export interface Authority extends Pems {
  /** This function issues a server certificate for the names. A name that is an IP address goes in the IP field. */
  issue(names: readonly string[], validity?: Validity): Promise<Pems>;
}

type Extensions = NonNullable<NonNullable<Parameters<typeof generate>[1]>["extensions"]>;

const DAY_MS = 86_400_000;

function serverExtensions(names: readonly string[]): Extensions {
  return [
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", serverAuth: true },
    { name: "subjectAltName", altNames: names.map((name) => (isIP(name) === 0 ? { type: 2, value: name } : { type: 7, ip: name })) },
  ];
}

function pemsOf(result: { readonly private: string; readonly cert: string }): Pems {
  return { key: result.private, cert: result.cert };
}

/** This function makes a root of trust with the common name. It is valid from one minute before the call for one day. */
export async function authority(commonName: string): Promise<Authority> {
  const now = Date.now();
  const root = pemsOf(
    await generate([{ name: "commonName", value: commonName }], {
      keyType: "ec",
      algorithm: "sha256",
      notBeforeDate: new Date(now - 60_000),
      notAfterDate: new Date(now + DAY_MS),
      extensions: [
        { name: "basicConstraints", cA: true },
        { name: "keyUsage", keyCertSign: true, cRLSign: true, digitalSignature: true },
      ],
    }),
  );
  return {
    ...root,
    issue: async (names, validity = {}) =>
      pemsOf(
        await generate([{ name: "commonName", value: names[0] ?? "server" }], {
          keyType: "ec",
          algorithm: "sha256",
          notBeforeDate: validity.notBefore ?? new Date(Date.now() - 60_000),
          notAfterDate: validity.notAfter ?? new Date(Date.now() + DAY_MS),
          extensions: serverExtensions(names),
          ca: { key: root.key, cert: root.cert },
        }),
      ),
  };
}

/** This function makes a self-signed server certificate for the names. It is valid for one day. */
export async function selfSigned(names: readonly string[]): Promise<Pems> {
  return pemsOf(
    await generate([{ name: "commonName", value: names[0] ?? "server" }], {
      keyType: "ec",
      algorithm: "sha256",
      notAfterDate: new Date(Date.now() + DAY_MS),
      extensions: serverExtensions(names),
    }),
  );
}

/** This function gives the validity of a certificate that expired one day before the call. */
export function expiredValidity(): Validity {
  const now = Date.now();
  return { notBefore: new Date(now - 3 * DAY_MS), notAfter: new Date(now - DAY_MS) };
}
