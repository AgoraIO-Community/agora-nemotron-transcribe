# ज़ुबान रेस source map

Source: `/Users/akshaynandwana/Desktop/agent-quickstart-nextjs`, an inspected, customized checkout of AgoraIO-Conversational-AI/agent-quickstart-nextjs. User explicitly requested this source and Conversational AI adaptation. The source checkout is unchanged.

| Source                                | Destination                           | Adaptation                                                                                                                                                  |
| ------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| app/api/invite-agent/route.ts         | app/api/invite-agent/route.ts         | Same AgoraClient/Agent SDK pipeline, RTM flags, VAD, reseller defaults and session lifecycle. Replace family-specific TTS and prompts with Hindi game host. |
| app/api/stop-conversation/route.ts    | app/api/stop-conversation/route.ts    | Same stopAgent/idempotent behavior, with a scoped signed stop capability.                                                                                   |
| app/api/generate-agora-token/route.ts | app/api/generate-agora-token/route.ts | Preserve combined RTC/RTM token builder; fix relative expiry; accept valid numeric agent-client UID.                                                        |
| components/LandingPage.tsx            | components/zubaan-game.tsx            | Preserve parallel invite+RTM setup, partial failure cleanup and teardown. New ten-level game and review presentation.                                       |
| components/ConversationComponent.tsx  | components/agent-session.tsx          | Copy StrictMode guard, useJoin/usePublish ownership, AgoraVoiceAI init, transcript/state events and dual-token renewal. Add mixed-audio recording inputs.   |
| lib/conversation.ts                   | components/agent-session.tsx          | Preserve local UID sentinel remap and completed/interrupted text.                                                                                           |
| lib/agora.ts                          | lib/agora.ts                          | Preserve agent UID 123456.                                                                                                                                  |

Source inspected: yes. Voice roundtrip verification remains separate from static checks and server startup.

Language extension: `lib/game.ts` owns independent Hindi/English catalogs, host prompts, and neutral transcription instructions. `invite-agent` selects matching ASR/TTS; `evaluate` validates language and scores only that catalog. The top-right switch clears prior results and is locked while connected. Official footer logos are local assets; Agora comes from the source quickstart, NVIDIA from its official brand site.

Free inference extension: `lib/hf-space.ts` uses the published Gradio upload/call/SSE API of `hugging-apps/nemotron-3-5-transcribe`. `lib/nemotron.ts` dispatches only to the explicitly selected provider. `NEMOTRON_PROVIDER=hf-space` requires no local model server; `HF_TOKEN` is optional and server-only. Readiness checks API shape without using GPU quota. Neither availability nor the metadata check reserves GPU time. Speech/scoring and Agora ownership are unchanged.
