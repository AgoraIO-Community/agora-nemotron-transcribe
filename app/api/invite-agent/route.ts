import {
  Agent,
  AgoraClient,
  Area,
  DeepgramSTT,
  ExpiresIn,
  MiniMaxTTS,
  OpenAI,
} from "agora-agents";
import { hostInstructions, hostGreeting } from "@/lib/game";
import { DEFAULT_AGENT_UID } from "@/lib/agora";
import { json, sameOrigin } from "@/lib/http";
import { sessionCapability } from "@/lib/agent-auth";
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
  const { requester_id, channel_name, language = "hi" } = body || {};
  if (language !== "hi" && language !== "en")
    return json({ error: "Choose Hindi or English." }, 400);
  if (
    typeof requester_id !== "string" ||
    !/^[1-9][0-9]{3,9}$/.test(requester_id) ||
    typeof channel_name !== "string" ||
    !/^zubaan-[a-f0-9-]{8,40}$/.test(channel_name)
  )
    return json({ error: "Start a new game session first." }, 400);
  const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID,
    appCertificate = process.env.NEXT_AGORA_APP_CERTIFICATE;
  if (!appId || !appCertificate)
    return json(
      { error: "Configure your Agora project credentials first." },
      503,
    );
  try {
    // Adapted from the supplied Next.js quickstart's Agent builder and RTM setup.
    const client = new AgoraClient({ appId, appCertificate, area: Area.US });
    const greeting = hostGreeting(language);
    const failureMessage =
      language === "en"
        ? "One moment, let’s try again."
        : "एक पल, फिर कोशिश करते हैं।";
    const agent = new Agent({
      client,
      instructions: hostInstructions(language),
      greeting,
      failureMessage,
      maxHistory: 50,
      turnDetection: {
        config: {
          speech_threshold: 0.5,
          start_of_speech: {
            mode: "vad",
            vad_config: { interrupt_duration_ms: 200, prefix_padding_ms: 300 },
          },
          end_of_speech: {
            mode: "vad",
            vad_config: { silence_duration_ms: 900 },
          },
        },
      },
      advancedFeatures: { enable_rtm: true },
      parameters: {
        audio_scenario: "chorus",
        data_channel: "rtm",
        enable_error_message: true,
        enable_metrics: true,
      },
    })
      .withStt(new DeepgramSTT({ model: "nova-3", language }))
      .withLlm(
        new OpenAI({
          model: "gpt-4o-mini",
          greetingMessage: greeting,
          failureMessage,
          maxHistory: 30,
          params: { max_tokens: 300, temperature: 0.6 },
        }),
      )
      .withTts(
        new MiniMaxTTS({
          model: "speech_2_6_turbo",
          voiceId:
            language === "en"
              ? process.env.AGORA_HOST_VOICE_EN || "English_Aussie_Bloke"
              : process.env.AGORA_HOST_VOICE_HI ||
                process.env.AGORA_HOST_VOICE ||
                "hindi_female_1_v2",
        }),
      );
    const session = agent.createSession({
      channel: channel_name,
      agentUid: String(DEFAULT_AGENT_UID),
      remoteUids: [requester_id],
      idleTimeout: 300,
      expiresIn: ExpiresIn.minutes(30),
      debug: false,
    });
    const agentId = await session.start();
    return json({
      agent_id: agentId,
      session_token: sessionCapability(agentId, channel_name),
    });
  } catch {
    return json(
      {
        error:
          "The host could not join. Check Conversational AI and RTM availability, reseller model access, and your Agora project configuration.",
      },
      502,
    );
  }
}
