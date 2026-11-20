import { X509Certificate } from "node:crypto";

import { derContainsOid } from "./asn1";
import { Buffer } from "./buffer";

const SKEW_MS = 5 * 60 * 1000;

export type CertificateInput = X509Certificate | string | Uint8Array;

export interface ChainInput {
  readonly leafDer: CertificateInput;
  readonly intermediateDer: CertificateInput;
  readonly roots: readonly CertificateInput[] | null | undefined;
  readonly now?: number | undefined;
  readonly leafOid?: Uint8Array | undefined;
  readonly intermediateOid?: Uint8Array | undefined;
}

export interface VerifiedChain {
  readonly leaf: X509Certificate;
  readonly intermediate: X509Certificate;
  readonly root: X509Certificate;
}

interface CertificatePair {
  readonly leaf: X509Certificate;
  readonly intermediate: X509Certificate;
}

const datesOk = (cert: X509Certificate, now: number): boolean => {
  const from = Date.parse(cert.validFrom);
  const to = Date.parse(cert.validTo);
  return (
    Number.isFinite(from) && Number.isFinite(to) && from - SKEW_MS <= now && now <= to + SKEW_MS
  );
};

const asCertificate = (value: CertificateInput): X509Certificate => {
  if (value instanceof X509Certificate) {
    return value;
  }
  if (typeof value === "string") {
    return new X509Certificate(value);
  }
  return new X509Certificate(Buffer.from(value));
};

const parsePair = (input: ChainInput): CertificatePair | null => {
  try {
    return {
      leaf: asCertificate(input.leafDer),
      intermediate: asCertificate(input.intermediateDer),
    };
  } catch {
    return null;
  }
};

const carriesOid = (cert: X509Certificate, oid: Uint8Array | undefined): boolean =>
  oid === undefined || derContainsOid(cert.raw, oid);

const pairHolds = (pair: CertificatePair, input: ChainInput, now: number): boolean => {
  const { leaf, intermediate } = pair;
  if (!datesOk(leaf, now) || !datesOk(intermediate, now)) {
    return false;
  }
  if (!carriesOid(leaf, input.leafOid) || !carriesOid(intermediate, input.intermediateOid)) {
    return false;
  }
  if (leaf.issuer !== intermediate.subject) {
    return false;
  }
  return leaf.verify(intermediate.publicKey);
};

const issuedBy = (intermediate: X509Certificate, root: X509Certificate, now: number): boolean =>
  datesOk(root, now) && intermediate.issuer === root.subject && intermediate.verify(root.publicKey);

export const verifyChain = (input: ChainInput): VerifiedChain | null => {
  const { roots, now = Date.now() } = input;
  if (!roots || roots.length === 0) {
    return null;
  }
  const pair = parsePair(input);
  if (!pair || !pairHolds(pair, input, now)) {
    return null;
  }
  for (const candidate of roots) {
    const root = asCertificate(candidate);
    if (issuedBy(pair.intermediate, root, now)) {
      return { ...pair, root };
    }
  }
  return null;
};
