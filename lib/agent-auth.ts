import { createHmac, timingSafeEqual } from "node:crypto";
export function sessionCapability(agentId: string, channel: string) {
  const content = Buffer.from(
    JSON.stringify({ agentId, channel, expires: Date.now() + 45 * 60000 }),
  ).toString("base64url");
  return (
    content +
    "." +
    createHmac("sha256", process.env.NEXT_AGORA_APP_CERTIFICATE!)
      .update(content)
      .digest("base64url")
  );
}
export function verifyCapability(token: unknown, agentId: string) {
  if (typeof token !== "string" || token.length > 1000) return false;
  const [content, signature] = token.split(".");
  if (!content || !signature || !process.env.NEXT_AGORA_APP_CERTIFICATE)
    return false;
  const expected = createHmac("sha256", process.env.NEXT_AGORA_APP_CERTIFICATE)
    .update(content)
    .digest("base64url");
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    return false;
  try {
    const payload = JSON.parse(Buffer.from(content, "base64url").toString());
    return payload.agentId === agentId && payload.expires > Date.now();
  } catch {
    return false;
  }
}
