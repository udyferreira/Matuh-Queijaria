import crypto from "crypto";
import https from "https";

const CERT_CACHE = new Map<string, { pem: string; expiresAt: number }>();
const CERT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TIMESTAMP_TOLERANCE_MS = 150 * 1000;

function validateCertUrl(certUrl: string): boolean {
  try {
    const url = new URL(certUrl);
    return (
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === "s3.amazonaws.com" &&
      url.pathname.startsWith("/echo.api/") &&
      (url.port === "" || url.port === "443")
    );
  } catch {
    return false;
  }
}

function fetchCert(certUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const cached = CERT_CACHE.get(certUrl);
    if (cached && cached.expiresAt > Date.now()) {
      return resolve(cached.pem);
    }

    https.get(certUrl, (res) => {
      let data = "";
      res.on("data", (chunk: string) => (data += chunk));
      res.on("end", () => {
        CERT_CACHE.set(certUrl, { pem: data, expiresAt: Date.now() + CERT_CACHE_TTL_MS });
        resolve(data);
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

function verifyCertChain(pem: string): boolean {
  try {
    const cert = new crypto.X509Certificate(pem);
    const validFrom = new Date(cert.validFrom);
    const validTo = new Date(cert.validTo);
    const now = new Date();

    if (now < validFrom || now > validTo) return false;

    const san = cert.subjectAltName || "";
    return san.includes("DNS:echo-api.amazon.com");
  } catch {
    return false;
  }
}

function verifySignature(pem: string, signature: string, body: Buffer): boolean {
  try {
    const verifier = crypto.createVerify("SHA256");
    verifier.update(body);
    return verifier.verify(pem, signature, "base64");
  } catch {
    return false;
  }
}

function validateTimestamp(requestBody: any): boolean {
  try {
    const timestamp = requestBody?.request?.timestamp;
    if (!timestamp) return false;
    const requestTime = new Date(timestamp).getTime();
    const now = Date.now();
    return Math.abs(now - requestTime) < TIMESTAMP_TOLERANCE_MS;
  } catch {
    return false;
  }
}

export async function verifyAlexaRequest(
  certChainUrl: string | undefined,
  signature: string | undefined,
  rawBody: Buffer,
  parsedBody: any,
  expectedSkillId?: string
): Promise<{ valid: boolean; reason?: string }> {
  if (process.env.NODE_ENV === "development") {
    return { valid: true };
  }

  if (!certChainUrl || !signature) {
    return { valid: false, reason: "Missing SignatureCertChainUrl or Signature headers" };
  }

  if (!validateCertUrl(certChainUrl)) {
    return { valid: false, reason: "Invalid certificate URL" };
  }

  if (!validateTimestamp(parsedBody)) {
    return { valid: false, reason: "Request timestamp too old or missing" };
  }

  if (expectedSkillId) {
    const appId =
      parsedBody?.session?.application?.applicationId ||
      parsedBody?.context?.System?.application?.applicationId;
    if (appId !== expectedSkillId) {
      return { valid: false, reason: `Skill ID mismatch: expected ${expectedSkillId}, got ${appId}` };
    }
  }

  try {
    const pem = await fetchCert(certChainUrl);

    if (!verifyCertChain(pem)) {
      return { valid: false, reason: "Certificate chain validation failed" };
    }

    if (!verifySignature(pem, signature, rawBody)) {
      return { valid: false, reason: "Signature verification failed" };
    }
  } catch (err: any) {
    return { valid: false, reason: `Verification error: ${err.message}` };
  }

  return { valid: true };
}
