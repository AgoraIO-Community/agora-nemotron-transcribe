import { AgoraClient, Area } from "agora-agents";
import { verifyCapability } from "@/lib/agent-auth";
import { json, sameOrigin } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return json({ error: "Cross-origin request rejected." }, 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  if (!body?.agent_id || !verifyCapability(body.session_token, body.agent_id))
    return json({ error: "Invalid or expired game session." }, 403);
  const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID,
    appCertificate = process.env.NEXT_AGORA_APP_CERTIFICATE;
  if (!appId || !appCertificate)
    return json({ error: "Agora is not configured." }, 503);
  try {
    await new AgoraClient({ appId, appCertificate, area: Area.US }).stopAgent(
      body.agent_id,
    );
    return json({ success: true });
  } catch (error) {
    const failure = error as { statusCode?: number; message?: string };
    if (
      failure.statusCode === 404 ||
      failure.message?.includes("already in the process of shutting down")
    )
      return json({ success: true });
    return json(
      {
        error:
          "Unable to stop the host. It will expire automatically after inactivity.",
      },
      502,
    );
  }
}
