"use client";

import { useEffect, useRef, useState } from "react";
import AgoraRTC, {
  AgoraRTCProvider,
  RemoteAudioTrack,
  TrackBoundary,
  useJoin,
  useLocalMicrophoneTrack,
  usePublish,
  useRemoteAudioTracks,
  useRemoteUsers,
  useRTCClient,
} from "agora-rtc-react";
import {
  AgoraVoiceAI,
  AgoraVoiceAIEvents,
  ChatMessagePriority,
  ChatMessageType,
  TranscriptHelperMode,
  TurnStatus,
} from "agora-agent-client-toolkit";
import type { RTMClient } from "agora-rtm";
import type { Credentials } from "@/lib/contracts";
import { DEFAULT_AGENT_UID } from "@/lib/agora";

export type AgentBridge = {
  send: (text: string) => Promise<void>;
  interrupt: () => Promise<void>;
};
export type AgentProps = {
  credentials: Credentials;
  rtm: RTMClient;
  muted: boolean;
  onBridge: (bridge: AgentBridge | null) => void;
  onTrack: (track: MediaStreamTrack | null) => void;
  onSpeech: (speaking: boolean) => void;
  onConnected: (connected: boolean) => void;
  onCaption: (text: string, speaker: "host" | "you") => void;
  onUser: (text: string) => void;
  onError: (text: string) => void;
};

export default function AgentSession(props: AgentProps) {
  /* eslint-disable react-hooks/refs */
  const client = useRef<ReturnType<typeof AgoraRTC.createClient> | null>(null);
  if (!client.current)
    client.current = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
  const engine = client.current;
  /* eslint-enable react-hooks/refs */
  return (
    <AgoraRTCProvider client={engine}>
      <Runtime {...props} />
    </AgoraRTCProvider>
  );
}

function Runtime(props: AgentProps) {
  const { credentials, rtm } = props;
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  const client = useRTCClient();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(timer);
  }, []);
  // Lifecycle and numeric UID mapping are copied from the supplied official quickstart.
  const join = useJoin(
    {
      appid: credentials.appId,
      channel: credentials.channel,
      token: credentials.token,
      uid: Number(credentials.uid),
    },
    ready,
  );
  const microphone = useLocalMicrophoneTrack(ready, {
    encoderConfig: "speech_standard",
    AEC: true,
    ANS: true,
  });
  const track = microphone.localMicrophoneTrack;
  const publication = usePublish([track], join.isConnected && Boolean(track));
  const remoteUsers = useRemoteUsers();
  const { audioTracks, error: remoteError } = useRemoteAudioTracks(remoteUsers);
  const hostPresent = remoteUsers.some(
    (user) => String(user.uid) === String(DEFAULT_AGENT_UID),
  );
  useEffect(() => {
    latest.current.onConnected(join.isConnected && hostPresent);
  }, [join.isConnected, hostPresent]);
  useEffect(() => {
    latest.current.onTrack(track?.getMediaStreamTrack() || null);
    return () => latest.current.onTrack(null);
  }, [track]);
  useEffect(() => {
    if (track)
      void track
        .setMuted(props.muted)
        .catch(() =>
          latest.current.onError("माइक बदल नहीं पाया। फिर कोशिश करो।"),
        );
  }, [track, props.muted]);
  useEffect(() => {
    if (join.error || microphone.error || publication.error || remoteError)
      latest.current.onError(
        "Live audio connect नहीं हुआ। Microphone permission और Agora setup जाँचें।",
      );
  }, [join.error, microphone.error, publication.error, remoteError]);

  useEffect(() => {
    if (!ready || !join.isConnected) return;
    let cancelled = false;
    let instance: AgoraVoiceAI | null = null;
    const seen = new Set<string>();
    void (async () => {
      try {
        const ai = await AgoraVoiceAI.init({
          rtcEngine: client,
          rtmEngine: rtm,
          renderMode: TranscriptHelperMode.TEXT,
          enableLog: false,
        });
        instance = ai;
        if (cancelled) {
          ai.unsubscribe();
          ai.destroy();
          return;
        }
        ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, (transcript) => {
          for (const item of transcript) {
            if (!item.text || item.text.startsWith("GAME_")) continue;
            const local =
              item.uid === "0" || String(item.uid) === credentials.uid;
            latest.current.onCaption(item.text, local ? "you" : "host");
            const key = `${item.uid}:${item.turn_id}`;
            if (
              local &&
              item.status !== TurnStatus.IN_PROGRESS &&
              !seen.has(key)
            ) {
              seen.add(key);
              latest.current.onUser(item.text);
            }
          }
        });
        ai.on(AgoraVoiceAIEvents.AGENT_SPEAKING_CHANGED, (_, speaking) =>
          latest.current.onSpeech(speaking),
        );
        ai.on(AgoraVoiceAIEvents.AGENT_ERROR, () =>
          latest.current.onError(
            "चुलबुल की आवाज़ अटक गई। Agora provider और project access जाँचें।",
          ),
        );
        ai.subscribeMessage(credentials.channel);
        latest.current.onBridge({
          send: (text) =>
            ai.sendText(String(DEFAULT_AGENT_UID), {
              messageType: ChatMessageType.TEXT,
              priority: ChatMessagePriority.INTERRUPTED,
              responseInterruptable: true,
              text,
            }),
          interrupt: () => ai.interrupt(String(DEFAULT_AGENT_UID)),
        });
      } catch {
        if (!cancelled)
          latest.current.onError(
            "Live Hindi captions connect नहीं हुए। RTM enablement जाँचें।",
          );
      }
    })();
    const renew = async () => {
      try {
        const response = await fetch(
          `/api/generate-agora-token?${new URLSearchParams({ channel: credentials.channel, uid: credentials.uid, agent: "true" })}`,
        );
        const data = await response.json();
        if (!response.ok) throw new Error();
        if (!cancelled) {
          await client.renewToken(data.token);
          await rtm.renewToken(data.token);
        }
      } catch {
        if (!cancelled)
          latest.current.onError("Session renewal failed. नया गेम शुरू करें।");
      }
    };
    client.on("token-privilege-will-expire", renew);
    client.on("token-privilege-did-expire", renew);
    return () => {
      cancelled = true;
      latest.current.onBridge(null);
      client.off("token-privilege-will-expire", renew);
      client.off("token-privilege-did-expire", renew);
      if (instance) {
        instance.unsubscribe();
        instance.destroy();
      }
    };
  }, [
    ready,
    join.isConnected,
    client,
    rtm,
    credentials.channel,
    credentials.uid,
  ]);

  return (
    <TrackBoundary>
      {audioTracks.map((audio) => (
        <RemoteAudioTrack key={audio.getUserId()} track={audio} play />
      ))}
    </TrackBoundary>
  );
}
