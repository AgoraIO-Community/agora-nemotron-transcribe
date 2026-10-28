import { randomUUID } from "node:crypto";
import { RtcRole, RtcTokenBuilder } from "agora-token";
import { json, sameOrigin } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!sameOrigin(request))
    return json({ error: "Cross-origin requests are not allowed." }, 403);
  const query = new URL(request.url).searchParams;
  const channel = query.get("channel") || "";
  const name = (query.get("name") || "Guest").trim();
  const existingUid = query.get("uid");
  const agentMode = query.get("agent") === "true";
  if (
    !/^[a-zA-Z0-9_-]{3,48}$/.test(channel) ||
    !/^[a-zA-Z0-9 _-]{1,24}$/.test(name) ||
    (existingUid &&
      !(agentMode
        ? /^[1-9][0-9]{3,9}$/.test(existingUid)
        : /^[a-zA-Z0-9 _-]{1,24}~[a-f0-9]{16}$/.test(existingUid)))
  )
    return json(
      {
        error:
          "Use a 3–48 character room ID and a 1–24 character name with letters, numbers, spaces, dashes or underscores.",
      },
      400,
    );
  const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
  const certificate = process.env.NEXT_AGORA_APP_CERTIFICATE;
  if (
    !appId ||
    !certificate ||
    !/^[a-f0-9]{32}$/i.test(appId) ||
    !/^[a-f0-9]{32}$/i.test(certificate)
  )
    return json(
      {
        error:
          "Configure the Agora App ID and App Certificate in .env.local first.",
      },
      503,
    );
  const uid =
    existingUid ||
    (agentMode
      ? String(1000000 + Math.floor(Math.random() * 900000000))
      : `${name}~${randomUUID().replaceAll("-", "").slice(0, 16)}`);
  // AccessToken2 takes relative seconds, not an epoch timestamp.
  const token = RtcTokenBuilder.buildTokenWithRtm(
    appId,
    certificate,
    channel,
    uid,
    RtcRole.PUBLISHER,
    3600,
    3600,
  );
  return json({ appId, token, uid, channel });
}
