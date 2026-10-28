"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RTMClient } from "agora-rtm";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  HelpCircle,
  LoaderCircle,
  Mic,
  MicOff,
  Play,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Trophy,
  Volume2,
  X,
  Zap,
} from "lucide-react";
import { type Credentials, type Setup } from "@/lib/contracts";
import {
  best,
  command,
  summary,
  twistersFor,
  type GameLanguage,
  type Evaluation,
  type Round,
} from "@/lib/game";
import { AttemptCapture } from "@/lib/attempt-capture";
import type { AgentBridge } from "./agent-session";

const AgentSession = dynamic(() => import("./agent-session"), { ssr: false });
type Phase =
  | "lobby"
  | "connecting"
  | "welcome"
  | "introducing"
  | "listening"
  | "checking"
  | "feedback"
  | "results"
  | "preview";
type Session = {
  credentials: Credentials;
  rtm: RTMClient;
  agentId: string;
  sessionToken: string;
};

export default function ZubaanGame({ setup }: { setup: Setup }) {
  const [language, setLanguage] = useState<GameLanguage>("hi");
  const t = useCallback(
    (hi: string, en: string) => (language === "en" ? en : hi),
    [language],
  );
  const TWISTERS = twistersFor(language);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const [phase, setPhase] = useState<Phase>("lobby");
  const [level, setLevel] = useState(0);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [hostTalking, setHostTalking] = useState(false);
  const [hostConnected, setHostConnected] = useState(false);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [caption, setCaption] = useState(
    "दस चुनौतियाँ। एक ज़ुबान। बोल के दिखाओ!",
  );
  const [captionSpeaker, setCaptionSpeaker] = useState<"host" | "you">("host");
  const [elapsed, setElapsed] = useState(0);
  const [meter, setMeter] = useState(0);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState(false);
  const [consent, setConsent] = useState(false);
  const [review, setReview] = useState(0);
  const [replayUrl, setReplayUrl] = useState("");
  const [autoListen, setAutoListen] = useState(false);
  const phaseRef = useRef<Phase>("lobby");
  const levelRef = useRef(0);
  const roundsRef = useRef<Round[]>([]);
  const sessionRef = useRef<Session | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const bridge = useRef<AgentBridge | null>(null);
  const recorder = useRef<AttemptCapture | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hostSpoke = useRef(false);
  const clips = useRef(new Map<number, Blob>());
  const replay = useRef<HTMLAudioElement | null>(null);
  const modal = useRef<HTMLElement | null>(null);
  const events = useRef({ user: (_: string) => {}, arm: () => {} });

  const transition = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);
  const reportError = useCallback((text: string) => setError(text), []);
  const onBridge = useCallback((next: AgentBridge | null) => {
    bridge.current = next;
    setBridgeReady(Boolean(next));
  }, []);
  const onTrack = useCallback((track: MediaStreamTrack | null) => {
    trackRef.current = track;
  }, []);
  const onConnected = useCallback(
    (connected: boolean) => setHostConnected(connected),
    [],
  );
  const onCaption = useCallback((text: string, speaker: "host" | "you") => {
    setCaption(text);
    setCaptionSpeaker(speaker);
  }, []);
  const onUser = useCallback((text: string) => events.current.user(text), []);
  const onSpeech = useCallback((speaking: boolean) => {
    setHostTalking(speaking);
    if (speaking) {
      hostSpoke.current = true;
      if (armTimer.current) clearTimeout(armTimer.current);
    }
    if (!speaking && hostSpoke.current && phaseRef.current === "introducing") {
      if (armTimer.current) clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => events.current.arm(), 450);
    }
  }, []);

  async function stopSession(current: Session | null) {
    if (!current) return;
    const stopped = await fetch("/api/stop-conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: current.agentId,
        session_token: current.sessionToken,
      }),
      keepalive: true,
    }).catch(() => null);
    await current.rtm.logout().catch(() => {});
    if (stopped && !stopped.ok)
      setError("Host cleanup failed; the agent will expire after inactivity.");
  }

  useEffect(() => {
    const teardown = () => {
      const current = sessionRef.current;
      if (current)
        void fetch("/api/stop-conversation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agent_id: current.agentId,
            session_token: current.sessionToken,
          }),
          keepalive: true,
        }).catch(() => {});
    };
    window.addEventListener("pagehide", teardown);
    // Invalidate pending startup on unmount so a late host is cleaned up.
    return () => {
      // Read the latest generation deliberately to invalidate pending work.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      window.removeEventListener("pagehide", teardown);
      teardown();
      recorder.current?.cancel();
      request.current?.abort();
      if (armTimer.current) clearTimeout(armTimer.current);
      void sessionRef.current?.rtm.logout().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (phase === "connecting" && bridgeReady && hostConnected)
      transition("welcome");
  }, [phase, bridgeReady, hostConnected, transition]);
  useEffect(() => {
    if (phase !== "connecting") return;
    const timer = setTimeout(() => {
      generation.current++;
      const current = sessionRef.current;
      sessionRef.current = null;
      setSession(null);
      transition("lobby");
      setError(
        t(
          "Host connect होने में बहुत समय लगा। माइक permission, RTM और Agora setup जाँचकर फिर कोशिश करें।",
          "The host took too long to connect. Check microphone access and Agora setup, then try again.",
        ),
      );
      void stopSession(current);
    }, 45000);
    return () => clearTimeout(timer);
  }, [phase, transition, t]);
  useEffect(() => {
    if (phase !== "introducing") return;
    // Visible fallback if a provider omits its speaking-state event; never record automatically in that case.
    const timer = setTimeout(() => setAutoListen(true), 14000);
    return () => {
      clearTimeout(timer);
      setAutoListen(false);
    };
  }, [phase, level]);

  useEffect(() => {
    if (!settings || !modal.current) return;
    const previous = document.activeElement as HTMLElement | null;
    const buttons = Array.from(
      modal.current.querySelectorAll<HTMLButtonElement>("button"),
    );
    buttons[0]?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettings(false);
      if (event.key === "Tab" && buttons.length) {
        const first = buttons[0],
          last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      previous?.focus();
    };
  }, [settings]);

  async function tell(event: string, data: unknown) {
    if (!bridge.current) {
      setError(
        t(
          "Host is still connecting. एक पल रुकें।",
          "The host is still connecting. One moment.",
        ),
      );
      return;
    }
    try {
      await bridge.current.send(`${event}\n${JSON.stringify(data)}`);
    } catch {
      setError(
        t(
          "Host तक संदेश नहीं पहुँचा। फिर कोशिश करें।",
          "Your message didn’t reach the host. Try again.",
        ),
      );
    }
  }

  async function startGame() {
    if (phaseRef.current !== "lobby" && phaseRef.current !== "preview") return;
    if (!consent) {
      setError(
        t(
          "शुरू करने से पहले microphone और attempts processing की अनुमति दें।",
          "Please allow microphone access and attempt processing before starting.",
        ),
      );
      return;
    }
    if (!setup.agora || !setup.inference) {
      setSettings(true);
      setError(
        t(
          "Agora credentials और NVIDIA inference endpoint जोड़ें। कोई नकली score नहीं दिखाया जाएगा।",
          "Configure Agora credentials and the NVIDIA inference endpoint to play.",
        ),
      );
      return;
    }
    const id = ++generation.current;
    transition("connecting");
    setError("");
    setRounds([]);
    roundsRef.current = [];
    clips.current.clear();
    setLevel(0);
    levelRef.current = 0;
    setEvaluation(null);
    setMuted(false);
    setCaption(
      t("चुलबुल backstage से आ रहा है…", "Chulbul is coming from backstage…"),
    );
    let pending: Session | null = null;
    try {
      const readiness = await fetch("/api/readiness", {
        signal: AbortSignal.timeout(10000),
      });
      const readinessData = await readiness.json();
      if (!readiness.ok) throw new Error(readinessData.error);
      if (id !== generation.current) return;
      const channel = `zubaan-${crypto.randomUUID()}`;
      const tokenResponse = await fetch(
        `/api/generate-agora-token?${new URLSearchParams({ channel, name: "Player", agent: "true" })}`,
      );
      const credentials = await tokenResponse.json();
      if (!tokenResponse.ok) throw new Error(credentials.error);
      const [agent, messaging] = await Promise.allSettled([
        fetch("/api/invite-agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel_name: channel,
            requester_id: credentials.uid,
            language,
          }),
        }).then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error);
          return data;
        }),
        (async () => {
          const { default: AgoraRTM } = await import("agora-rtm");
          const rtm: RTMClient = new AgoraRTM.RTM(
            credentials.appId,
            credentials.uid,
          );
          try {
            await rtm.login({ token: credentials.token });
            await rtm.subscribe(channel);
            return rtm;
          } catch (error) {
            await rtm.logout().catch(() => {});
            throw error;
          }
        })(),
      ]);
      if (agent.status === "rejected" || messaging.status === "rejected") {
        if (agent.status === "fulfilled")
          await fetch("/api/stop-conversation", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              agent_id: agent.value.agent_id,
              session_token: agent.value.session_token,
            }),
          }).catch(() => {});
        if (messaging.status === "fulfilled")
          await messaging.value.logout().catch(() => {});
        throw agent.status === "rejected"
          ? agent.reason
          : new Error(
              t(
                "RTM connect नहीं हुआ। Project में RTM enablement जाँचें।",
                "Messaging could not connect. Check RTM is enabled in your project.",
              ),
            );
      }
      pending = {
        credentials,
        rtm: messaging.value,
        agentId: agent.value.agent_id,
        sessionToken: agent.value.session_token,
      };
      if (id !== generation.current) {
        await stopSession(pending);
        return;
      }
      sessionRef.current = pending;
      setSession(pending);
    } catch (cause) {
      if (pending) await stopSession(pending);
      if (id === generation.current) {
        setError(
          cause instanceof Error
            ? cause.message
            : t("Host connect नहीं हुआ।", "The host could not connect."),
        );
        transition("lobby");
      }
    }
  }

  function introduce(next: number) {
    if (armTimer.current) clearTimeout(armTimer.current);
    recorder.current?.cancel();
    recorder.current = null;
    setElapsed(0);
    setMeter(0);
    setEvaluation(null);
    setError("");
    if (next >= TWISTERS.length) {
      finishGame();
      return;
    }
    levelRef.current = next;
    setLevel(next);
    hostSpoke.current = false;
    transition("introducing");
    void tell("GAME_LEVEL", {
      number: next + 1,
      total: 10,
      phrase: TWISTERS[next].text,
      instruction: t(
        "Read this exact phrase once in Hindi, then say तुम्हारी बारी and stay quiet. Do not start another level yourself.",
        "Read this exact phrase once in English, then say Your turn and stay quiet. Do not start another level yourself.",
      ),
    });
  }

  function armAttempt() {
    if (phaseRef.current !== "introducing" || !trackRef.current) return;
    if (hostTalking) {
      setError(
        t(
          "चुलबुल को बोल लेने दो, फिर तुम्हारी बारी!",
          "Let Chulbul finish, then it’s your turn!",
        ),
      );
      return;
    }
    if (muted) {
      setError(t("पहले माइक unmute करो।", "Unmute your microphone first."));
      return;
    }
    const currentLevel = levelRef.current,
      id = generation.current;
    recorder.current?.cancel();
    transition("listening");
    setElapsed(0);
    setMeter(0);
    const capture = new AttemptCapture(
      (volume, seconds) => {
        setMeter(volume);
        setElapsed(seconds);
      },
      (blob, seconds) => {
        if (id === generation.current)
          void scoreAttempt(blob, seconds, currentLevel);
      },
      (message) => {
        if (id === generation.current) {
          setError(
            message === "आवाज़ सुनाई नहीं दी। माइक के पास बोलकर फिर कोशिश करो।"
              ? t(
                  message,
                  "No speech detected. Speak near your microphone and try again.",
                )
              : message,
          );
          transition("feedback");
        }
      },
    );
    recorder.current = capture;
    void capture.arm(trackRef.current);
  }

  async function scoreAttempt(
    blob: Blob,
    speakingSeconds: number,
    currentLevel: number,
  ) {
    transition("checking");
    setMeter(0);
    recorder.current = null;
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch(
        `/api/evaluate?${new URLSearchParams({ language, level: String(currentLevel), seconds: speakingSeconds.toFixed(3) })}`,
        {
          method: "POST",
          headers: { "Content-Type": "audio/wav" },
          body: blob,
          signal: controller.signal,
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const voiceAction = command(data.transcript || "");
      if (voiceAction === "retry" || voiceAction === "repeat") {
        introduce(currentLevel);
        return;
      }
      if (voiceAction === "stop") {
        await leave();
        return;
      }
      const result = data as Evaluation;
      if (controller.signal.aborted) return;
      const previous = roundsRef.current.find(
        (round) => round.level === currentLevel,
      );
      if (!previous || result.score > best(previous).score)
        clips.current.set(currentLevel, blob);
      const next = previous
        ? roundsRef.current.map((round) =>
            round.level === currentLevel
              ? { ...round, attempts: [...round.attempts, result] }
              : round,
          )
        : [...roundsRef.current, { level: currentLevel, attempts: [result] }];
      roundsRef.current = next;
      setRounds(next);
      setEvaluation(result);
      transition("feedback");
      void tell("GAME_RESULT", {
        level: currentLevel + 1,
        expected: TWISTERS[currentLevel].text,
        heard: result.transcript,
        wordMatch: result.match,
        points: result.score,
        seconds: result.speakingSeconds,
        differences: result.differences.filter((word) => word.kind !== "match"),
        instruction: t(
          "React warmly in one or two short Hindi sentences. Mention the actual word match and at most one exact difference. Ask दोबारा या अगला. Do not diagnose pronunciation or advance by yourself.",
          "React warmly in one or two English sentences. Mention actual word match and at most one exact difference. Ask Try again or next. Do not diagnose pronunciation or advance yourself.",
        ),
      });
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(
          cause instanceof Error
            ? cause.message
            : "NVIDIA evaluation failed. No score calculated.",
        );
        transition("feedback");
        void tell("GAME_ERROR", {
          instruction:
            "Tell the player inference is unavailable, no score was calculated, and they can retry. Do not invent results.",
        });
      }
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  function finishGame() {
    recorder.current?.cancel();
    transition("results");
    setReview(0);
    const report = summary(roundsRef.current);
    void tell("GAME_SUMMARY", {
      score: report.score,
      maximum: 10000,
      passed: report.passed,
      completed: report.results.length,
      averageWordMatch: report.average,
      speakingSeconds: Number(report.seconds.toFixed(1)),
      results: report.results.map((item) => ({
        level: item.level + 1,
        phrase: TWISTERS[item.level].text,
        match: item.match,
        points: item.score,
        differences: item.differences.filter((word) => word.kind !== "match"),
      })),
      instruction: t(
        "Give a concise Hindi review: actual score, one strongest round, one specific word difference to practice. Explain this measures transcript word match, not verified pronunciation. Then invite questions and discuss only these results.",
        "Give a concise English review: actual score, one strongest round, one specific word difference to practice. Explain this measures transcript word match, not verified pronunciation. Invite questions and discuss only these results.",
      ),
    });
  }

  async function leave() {
    generation.current++;
    if (armTimer.current) clearTimeout(armTimer.current);
    recorder.current?.cancel();
    recorder.current = null;
    request.current?.abort();
    const current = sessionRef.current;
    sessionRef.current = null;
    setSession(null);
    setHostConnected(false);
    setBridgeReady(false);
    transition("lobby");
    await stopSession(current);
  }

  useEffect(() => {
    events.current = {
      arm: armAttempt,
      user: (text) => {
        const action = command(text),
          state = phaseRef.current;
        if (!action) return;
        if (action === "stop") {
          void leave();
          return;
        }
        if (state === "welcome" && ["start", "next"].includes(action)) {
          introduce(0);
          return;
        }
        if (["checking", "connecting", "results"].includes(state)) return;
        if (action === "repeat" || action === "retry") {
          introduce(levelRef.current);
          return;
        }
        if (state === "feedback" && action === "next") {
          if (
            roundsRef.current.some(
              (round) =>
                round.level === levelRef.current && round.attempts.length,
            )
          )
            introduce(levelRef.current + 1);
          else
            setError(
              t(
                "इस level का score अभी नहीं बना। पहले दोबारा कोशिश करो।",
                "This round has no score yet. Try it again first.",
              ),
            );
        }
      },
    };
  });

  useEffect(() => {
    const selected =
      phase === "results"
        ? summary(rounds).results[review]?.level
        : evaluation?.level;
    const blob = selected === undefined ? null : clips.current.get(selected);
    if (!blob) {
      setReplayUrl("");
      return;
    }
    const url = URL.createObjectURL(blob);
    setReplayUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [phase, evaluation, review, rounds]);

  async function shareCard() {
    const report = summary(rounds);
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffcc33";
    ctx.fillRect(0, 0, 1080, 1350);
    ctx.fillStyle = "#ff476f";
    for (let index = 0; index < 12; index++) {
      ctx.beginPath();
      ctx.moveTo(540, 650);
      const angle = (index / 12) * Math.PI * 2;
      ctx.lineTo(540 + Math.cos(angle) * 1800, 650 + Math.sin(angle) * 1800);
      ctx.lineTo(
        540 + Math.cos(angle + 0.12) * 1800,
        650 + Math.sin(angle + 0.12) * 1800,
      );
      ctx.fill();
    }
    ctx.fillStyle = "#fff9e9";
    ctx.fillRect(70, 150, 940, 1040);
    ctx.strokeStyle = "#19141d";
    ctx.lineWidth = 12;
    ctx.strokeRect(70, 150, 940, 1040);
    ctx.textAlign = "center";
    ctx.fillStyle = "#682ce8";
    ctx.font =
      language === "en" ? "900 85px sans-serif" : "900 95px sans-serif";
    ctx.fillText(t("ज़ुबान रेस", "ZUBAAN RACE"), 540, 335);
    ctx.fillStyle = "#19141d";
    ctx.font = "bold 45px sans-serif";
    ctx.fillText(
      t("ज़ुबान फिसली, गेम गया!", "BIG TALK. TIED TONGUE."),
      540,
      420,
    );
    ctx.font = "900 175px sans-serif";
    ctx.fillText(String(report.score), 540, 650);
    ctx.font = "bold 32px sans-serif";
    ctx.fillText("/ 10,000 POINTS", 540, 710);
    ctx.font = "bold 42px sans-serif";
    ctx.fillText(
      `${report.passed}/10 cleared · ${report.average}% word match`,
      540,
      835,
    );
    ctx.font = "36px sans-serif";
    ctx.fillText(`${report.seconds.toFixed(1)}s speaking time`, 540, 910);
    ctx.fillStyle = "#682ce8";
    ctx.font = "bold 55px sans-serif";
    ctx.fillText(t("अब बोल के दिखाओ!", "CAN YOU BEAT THAT?"), 540, 1040);
    ctx.fillStyle = "#19141d";
    ctx.font = "25px sans-serif";
    ctx.fillText("Agora Conversational AI × NVIDIA Nemotron", 540, 1130);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) return;
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = "zubaan-race-score.png";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const report = summary(rounds),
    twister = TWISTERS[level];
  const reviewed = report.results[review];
  const inGame = !["lobby", "preview"].includes(phase);
  const status =
    phase === "connecting"
      ? "BACKSTAGE…"
      : hostTalking
        ? t("चुलबुल बोल रहा है", "CHULBUL IS SPEAKING")
        : phase === "listening"
          ? t("तुम्हारी बारी!", "YOUR TURN!")
          : phase === "checking"
            ? t("NVIDIA जाँच रहा है", "NVIDIA IS CHECKING")
            : phase === "results"
              ? t("पूछो, क्या बेहतर करें?", "ASK ME WHAT TO PRACTICE")
              : t("चुलबुल सुन रहा है", "CHULBUL IS LISTENING");

  return (
    <div className={`race-app ${phase === "lobby" ? "is-lobby" : ""}`}>
      <header className="race-header">
        <div className="race-brand">
          <span className="brand-mic">
            <Mic size={22} />
          </span>
          <span>
            {t("ज़ुबान", "ZUBAAN")}
            <span className="brand-race">{t("रेस", "RACE")}</span>
            <small>ZUBAAN RACE</small>
          </span>
        </div>
        <div className="header-badge">
          <i />
          {t("एक प्लेयर। पूरा धमाल।", "One player. Maximum chaos.")}
        </div>
        <div className="header-actions">
          <div
            className="language-switch"
            role="group"
            aria-label="Game language"
            title={
              inGame
                ? t(
                    "भाषा बदलने के लिए पहले खेल से बाहर आएँ",
                    "Exit the game to change language",
                  )
                : "Game language"
            }
          >
            {(["hi", "en"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={language === value}
                disabled={inGame}
                onClick={() => {
                  setLanguage(value);
                  setLevel(0);
                  setRounds([]);
                  roundsRef.current = [];
                  setEvaluation(null);
                  clips.current.clear();
                  setError("");
                  setCaption(
                    value === "en"
                      ? "Ten challenges. One tongue. Show us what you’ve got!"
                      : "दस चुनौतियाँ। एक ज़ुबान। बोल के दिखाओ!",
                  );
                }}
              >
                {value === "hi" ? "हिंदी" : "English"}
              </button>
            ))}
          </div>
          <button
            title="Setup and game rules"
            aria-label="Setup and game rules"
            className="round-icon"
            onClick={() => setSettings(true)}
          >
            <Settings2 size={18} />
          </button>
          {inGame && (
            <button className="exit-button" onClick={() => void leave()}>
              <X size={15} />
              {t("बाहर", "Exit")}
            </button>
          )}
        </div>
      </header>
      <main className="race-main">
        {phase === "lobby" ? (
          <section className="lobby-scene">
            <div className="comic-sticker sticker-one">
              {t("बोल के", "SAY IT.")}
              <br />
              {t("दिखाओ!", "NAIL IT!")}
            </div>
            <div className="comic-sticker sticker-two">
              10 LEVELS
              <br />
              <span>NO TYPING.</span>
            </div>
            <div className="lobby-copy">
              <span className="tiny-pill">
                <Zap size={13} fill="currentColor" />
                {t(
                  "THE HINDI TONGUE-TWISTER CHALLENGE",
                  "THE ENGLISH TONGUE-TWISTER CHALLENGE",
                )}
              </span>
              <h1>
                {t("ज़ुबान फिसली,", "BIG TALK.")}
                <br />
                <span>{t("गेम गया!", "TIED TONGUE.")}</span>
              </h1>
              <p>
                {t(
                  "दस टंग ट्विस्टर। एक चुलबुला AI होस्ट।",
                  "Ten tongue twisters. One cheeky AI host.",
                )}
                <br />
                {t(
                  "देखते हैं, तुम्हारी ज़ुबान में कितना दम है!",
                  "Your mouth called. It wants a challenge.",
                )}
              </p>
              <div className="lobby-facts">
                <span>
                  <Mic size={15} />
                  {t("बोलो", "Speak")}
                </span>
                <i>→</i>
                <span>
                  <Sparkles size={15} />
                  {t("AI से जँचवाओ", "Let AI check it")}
                </span>
                <i>→</i>
                <span>
                  <Trophy size={15} />
                  {t("अपना स्कोर जानो", "Get your score")}
                </span>
              </div>
              <label className="consent-label">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <span>
                  {t(
                    "मेरी आवाज़ के छोटे attempts NVIDIA को जाँच के लिए भेजे जा सकते हैं।",
                    "I agree to send short voice attempts to NVIDIA for evaluation.",
                  )}
                </span>
              </label>
              <button className="big-cta" onClick={() => void startGame()}>
                <Mic size={23} />
                {t("माइक ऑन, गेम ऑन!", "MIC ON. GAME ON!")}
                <ArrowRight size={23} />
              </button>
              <button
                className="preview-link"
                onClick={() => {
                  setLevel(0);
                  transition("preview");
                }}
              >
                {t("पहले चुनौतियाँ देखूँ", "Peek at the challenges")}
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="lobby-host">
              <div className="speech-pop">
                {t("मैं हूँ चुलबुल।", "I’m Chulbul.")}
                <br />
                <strong>{t("तैयार हो, उस्ताद?", "Ready, big talker?")}</strong>
              </div>
              <HostMascot talking={false} large />
              <span className="host-name">
                {t("चुलबुल", "CHULBUL")} <span>YOUR AI HOST</span>
              </span>
              <div className="mini-note">
                <HeadphoneMark />
                {t("हेडफ़ोन लगाओ। मज़ा बढ़ाओ।", "Headphones on. Ego off.")}
              </div>
            </div>
            <span className="comic-spark spark-one">✦</span>
            <span className="comic-spark spark-two">✳</span>
          </section>
        ) : (
          <section className={`game-scene phase-${phase}`}>
            <aside className="level-rail" aria-label="Ten challenges">
              {TWISTERS.map((item, index) => (
                <div
                  key={item.id}
                  className={`level-dot ${level === index && phase !== "results" ? "current" : ""} ${rounds.find((round) => round.level === index) ? "done" : ""}`}
                  title={item.title}
                >
                  {rounds.find((round) => round.level === index) ? (
                    <Check size={16} />
                  ) : (
                    String(index + 1).padStart(2, "0")
                  )}
                </div>
              ))}
            </aside>
            <div className="game-center">
              <div className="game-topline">
                <span className="tiny-pill dark">
                  {phase === "results"
                    ? "THE FINAL RECEIPTS"
                    : phase === "preview"
                      ? t("सिर्फ़ एक झलक · NO MIC", "SNEAK PEEK · NO MIC")
                      : `LEVEL ${String(level + 1).padStart(2, "0")} / 10`}
                </span>
                <div className="score-chip">
                  <Zap size={14} fill="currentColor" />
                  {report.score.toLocaleString()} <small>PTS</small>
                </div>
              </div>
              {phase === "results" ? (
                <div className="result-stage">
                  <span className="result-sticker">
                    {t("क्या बात है!", "LOOK AT YOU!")}
                  </span>
                  <h2>{t("ज़ुबान का हिसाब।", "THE TONGUE REPORT.")}</h2>
                  <div className="final-score">
                    {report.score.toLocaleString()}
                    <span>/ 10,000</span>
                  </div>
                  <div className="final-metrics">
                    <span>
                      <strong>{report.passed}/10</strong>
                      {t("चुनौतियाँ पार", "rounds cleared")}
                    </span>
                    <span>
                      <strong>{report.average}%</strong>word match
                    </span>
                    <span>
                      <strong>{report.seconds.toFixed(1)}s</strong>
                      {t("बोलने का समय", "speaking time")}
                    </span>
                  </div>
                  <div className="review-box">
                    <div className="review-pager">
                      <button
                        aria-label="Previous result"
                        disabled={review <= 0}
                        onClick={() => setReview((value) => value - 1)}
                      >
                        <ChevronLeft size={17} />
                      </button>
                      <strong>
                        {reviewed
                          ? `${reviewed.level + 1}. ${TWISTERS[reviewed.level].title}`
                          : t("अभी कोई attempt नहीं हुआ", "No attempts yet")}
                      </strong>
                      <button
                        aria-label="Next result"
                        disabled={review >= report.results.length - 1}
                        onClick={() => setReview((value) => value + 1)}
                      >
                        <ChevronRight size={17} />
                      </button>
                    </div>
                    {reviewed && (
                      <WordDifferences result={reviewed} language={language} />
                    )}
                  </div>
                  <div className="result-actions">
                    <button
                      className="small-cta"
                      onClick={() => void shareCard()}
                    >
                      <Download size={16} />
                      {t("स्कोर कार्ड", "Score card")}
                    </button>
                    <button
                      className="outline-cta"
                      onClick={() =>
                        void tell("GAME_QUESTION", {
                          question: t(
                            "मेरी सबसे बड़ी गलती क्या थी और कौन से शब्द अच्छे बोले? Use only the supplied GAME_SUMMARY.",
                            "Which words matched well, and which differences should I practice? Use only the supplied GAME_SUMMARY.",
                          ),
                        })
                      }
                    >
                      <Volume2 size={16} />
                      {t("चुलबुल, समझाओ!", "Talk me through it!")}
                    </button>
                  </div>
                  <p className="fairness">
                    {t(
                      "Word match है, pronunciation certificate नहीं। Replay से खुद भी जाँचो।",
                      "Word match, not a pronunciation certificate. Replay your attempt to check.",
                    )}
                  </p>
                </div>
              ) : (
                <div className={`challenge-card color-${twister.color}`}>
                  <div className="challenge-title">
                    <span>{twister.difficulty}</span>
                    <span>✦ {twister.target}s TARGET</span>
                  </div>
                  <h2>{twister.title}</h2>
                  <div
                    className={`twister-text ${twister.text.length > 65 ? "long-phrase" : ""}`}
                  >
                    {twister.text}
                  </div>
                  <div className="challenge-divider" />
                  {phase === "preview" ? (
                    <div className="preview-controls">
                      <button
                        className="outline-cta"
                        disabled={level === 0}
                        onClick={() => setLevel((value) => value - 1)}
                      >
                        <ChevronLeft size={16} />
                        {t("पिछला", "Previous")}
                      </button>
                      <span>
                        {t(
                          "स्कोर सिर्फ़ असली आवाज़ पर।",
                          "Real voice. Real word match.",
                        )}
                      </span>
                      <button
                        className="outline-cta"
                        disabled={level === 9}
                        onClick={() => setLevel((value) => value + 1)}
                      >
                        {t("अगला", "Next")}
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  ) : phase === "connecting" ? (
                    <div className="attempt-status">
                      <LoaderCircle className="spin" />
                      {t(
                        "माइक और AI होस्ट connect हो रहे हैं…",
                        "Connecting your microphone and AI host…",
                      )}
                    </div>
                  ) : phase === "welcome" ? (
                    <div className="welcome-action">
                      <p>
                        {t("होस्ट को जवाब दो:", "Tell your host:")}{" "}
                        <strong>{t("“शुरू करो!”", "“Start!”")}</strong>
                      </p>
                      <button
                        className="small-cta"
                        disabled={!bridgeReady || !hostConnected}
                        onClick={() => introduce(0)}
                      >
                        <Play size={16} fill="currentColor" />
                        {t("मैं तैयार हूँ!", "I’m ready!")}
                      </button>
                    </div>
                  ) : phase === "listening" ? (
                    <div className="listening-block">
                      <div
                        className="voice-wave"
                        aria-label="Microphone input level"
                      >
                        {Array.from({ length: 27 }, (_, index) => (
                          <i
                            key={index}
                            style={{
                              height: `${9 + meter * (18 + Math.abs(Math.sin(index * 1.3)) * 65)}px`,
                            }}
                          />
                        ))}
                      </div>
                      <strong>
                        {t("अब बोलो। पूरा बोलो।", "Your turn. Go all in.")}
                      </strong>
                      <span>
                        {elapsed.toFixed(1)}s{" "}
                        <small>
                          {t(
                            "खामोशी पर अपने-आप जाँच",
                            "Silence ends your attempt",
                          )}
                        </small>
                      </span>
                      <button
                        className="text-fallback"
                        onClick={() => recorder.current?.stop()}
                      >
                        <Square size={11} />
                        {t("मैंने बोल लिया", "Done speaking")}
                      </button>
                    </div>
                  ) : phase === "checking" ? (
                    <div className="checking-block">
                      <span className="nvidia-loader">
                        <Sparkles size={27} />
                      </span>
                      <strong>
                        {t("NVIDIA ने क्या सुना?", "What did NVIDIA hear?")}
                      </strong>
                      <p>
                        {t(
                          setup.inferenceProvider === "hf-space"
                            ? "फ़्री GPU पर इंतज़ार हो सकता है। बोलने का समय सुरक्षित है।"
                            : "तुम्हारी recording की जाँच हो रही है।",
                          setup.inferenceProvider === "hf-space"
                            ? "Free GPU may queue. Your speaking time is saved."
                            : "Checking your recorded attempt.",
                        )}
                      </p>
                    </div>
                  ) : phase === "feedback" ? (
                    <div className="feedback-stage">
                      {evaluation ? (
                        <>
                          <div className="attempt-score">
                            <strong>{evaluation.match}%</strong>
                            <span>WORD MATCH</span>
                            <b>+{evaluation.score} PTS</b>
                          </div>
                          <WordDifferences
                            result={evaluation}
                            language={language}
                          />
                          <div className="feedback-actions">
                            <button
                              className="outline-cta"
                              onClick={() => introduce(level)}
                            >
                              <RotateCcw size={15} />
                              {t("दोबारा", "Try again")}
                            </button>
                            <button
                              className="small-cta"
                              onClick={() => introduce(level + 1)}
                            >
                              {level === 9
                                ? t("मेरा रिज़ल्ट", "My results")
                                : t("अगला", "Next")}
                              <ArrowRight size={16} />
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="retry-empty">
                          <p>
                            {t(
                              "इस attempt का score नहीं बना।",
                              "No score for this attempt.",
                            )}
                          </p>
                          <button
                            className="small-cta"
                            onClick={() => introduce(level)}
                          >
                            <RotateCcw size={15} />
                            {t("फिर कोशिश करें", "Try again")}
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="attempt-status">
                      <Volume2
                        className={hostTalking ? "bounce" : ""}
                        size={21}
                      />
                      <span>
                        {t("पहले चुलबुल को सुनो…", "Listen to Chulbul first…")}
                      </span>
                      {autoListen && (
                        <button className="small-cta" onClick={armAttempt}>
                          {t("अब मेरी बारी", "My turn now")}
                          <Mic size={14} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className="bottom-controls">
                {phase === "preview" ? (
                  <button
                    className="outline-cta"
                    onClick={() => transition("lobby")}
                  >
                    <ArrowLeft size={14} />
                    {t("वापस चलें", "Back to lobby")}
                  </button>
                ) : (
                  <>
                    <button
                      className={`mic-toggle ${muted ? "muted" : ""}`}
                      disabled={phase === "listening"}
                      onClick={() => setMuted((value) => !value)}
                      aria-label={
                        muted ? "Unmute microphone" : "Mute microphone"
                      }
                    >
                      {muted ? <MicOff size={18} /> : <Mic size={18} />}
                    </button>
                    <span>
                      {t("बोलो:", "Say:")} <b>{t("“दोहराओ”", "“repeat”")}</b> ·{" "}
                      <b>{t("“दोबारा”", "“try again”")}</b> ·{" "}
                      <b>{t("“अगला”", "“next”")}</b>
                    </span>
                    <button
                      className="round-icon"
                      title="Repeat this phrase"
                      aria-label="Repeat this phrase"
                      disabled={
                        !bridgeReady ||
                        phase === "checking" ||
                        phase === "results"
                      }
                      onClick={() => introduce(level)}
                    >
                      <Volume2 size={18} />
                    </button>
                  </>
                )}
              </div>
            </div>
            <aside className="host-panel">
              <div className="live-label">
                <i className={hostConnected ? "connected" : ""} />
                {phase === "preview"
                  ? "MEET YOUR HOST"
                  : "AGORA CONVERSATIONAL AI"}
              </div>
              <HostMascot talking={hostTalking} />
              <div className="host-identity">
                <strong>{t("चुलबुल", "Chulbul")}</strong>
                <span>
                  {t(
                    "थोड़ा शरारती। पूरा सपोर्टिव।",
                    "A little cheeky. Always in your corner.",
                  )}
                </span>
              </div>
              <div
                className={`host-caption ${captionSpeaker === "you" ? "player-caption" : ""}`}
              >
                <span>
                  {captionSpeaker === "host"
                    ? t("चुलबुल कह रहा है", "CHULBUL SAYS")
                    : t("तुमने कहा", "YOU SAID")}
                </span>
                <p>
                  {phase === "preview"
                    ? t(
                        "मुझसे बातें भी होंगी, और ज़ुबान की कसरत भी!",
                        "A little banter. A serious tongue workout!",
                      )
                    : caption}
                </p>
              </div>
              <div className="host-status">
                <span
                  className={hostTalking ? "voice-dot speaking" : "voice-dot"}
                />
                {status}
              </div>
              {replayUrl && (
                <div className="replay-control">
                  <button
                    className="outline-cta"
                    onClick={() => {
                      void replay.current
                        ?.play()
                        .catch(() =>
                          setError(
                            t("Replay नहीं चल पाया।", "Replay could not play."),
                          ),
                        );
                    }}
                  >
                    <Play size={13} fill="currentColor" />
                    {t("अपना attempt सुनो", "Replay my attempt")}
                  </button>
                  <audio ref={replay} src={replayUrl} />
                </div>
              )}
            </aside>
          </section>
        )}
        {error && (
          <div className="game-error" role="alert">
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={15} />
            </button>
          </div>
        )}
      </main>
      <footer className="race-footer">
        <div className="tech-credit">
          <Image
            className="partner-logo agora-logo"
            src="/agora-logo-rgb-blue.svg"
            alt="Agora"
            width={85}
            height={28}
          />
          <b>×</b>
          <a
            className="nvidia-credit"
            href="https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B"
            target="_blank"
            rel="noreferrer"
          >
            <Image
              className="partner-logo nvidia-logo"
              src="/nvidia-logo.svg"
              alt="NVIDIA"
              width={112}
              height={28}
            />
            <small>NEMOTRON 3.5 TRANSCRIBE</small>
          </a>
        </div>
        <span className="footer-note">
          {t(
            setup.inferenceProvider === "hf-space"
              ? "NVIDIA · फ़्री Hugging Face GPU · रोज़ की सीमा"
              : "Live Hindi host + हर attempt का NVIDIA word match",
            setup.inferenceProvider === "hf-space"
              ? "NVIDIA on free Hugging Face GPU · daily quota"
              : "Live AI host + NVIDIA word match on every attempt",
          )}
        </span>
        <button className="rules-button" onClick={() => setSettings(true)}>
          <HelpCircle size={13} />
          {t("कैसे खेलें?", "How to play?")}
        </button>
      </footer>
      {settings && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="rules-modal"
            ref={modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rules-title"
          >
            <button
              className="modal-close"
              aria-label="Close setup"
              onClick={() => setSettings(false)}
            >
              <X size={20} />
            </button>
            <span className="tiny-pill">
              {t("छोटा सा नियम-पत्र", "THE SMALL PRINT")}
            </span>
            <h2 id="rules-title">
              {t("मज़ा पूरा। नियम सीधे।", "Big fun. Simple rules.")}
            </h2>
            <div className="rule-grid">
              <p>
                <b>01</b>
                {t(
                  "Start दबाओ, माइक की अनुमति दो।",
                  "Hit Start and allow your microphone.",
                )}
              </p>
              <p>
                <b>02</b>
                {t("चुलबुल को “शुरू करो” बोलो।", "Tell Chulbul “start”.")}
              </p>
              <p>
                <b>03</b>
                {t(
                  "Phrase बोलो। रुकते ही NVIDIA जाँचेगा।",
                  "Say the phrase. NVIDIA checks when you pause.",
                )}
              </p>
              <p>
                <b>04</b>
                {t(
                  "“दोबारा” या “अगला” बोलकर खेलो।",
                  "Say “try again” or “next” to keep playing.",
                )}
              </p>
            </div>
            <p className="rule-detail">
              {t(
                "हर level पर 800 word-match points + 200 speed points। Speed bonus के लिए कम-से-कम 90% word match। Retry पर तुम्हारा best attempt गिना जाएगा। GPU processing का समय score में नहीं जुड़ता।",
                "Each round: 800 word-match points + 200 speed points. Reach 90% word match to unlock the speed bonus. Retries keep your best attempt. GPU wait time never affects your score.",
              )}
            </p>
            <div className="setup-chips">
              <span className={setup.agora ? "configured" : ""}>
                {setup.agora ? <Check size={13} /> : <X size={13} />}Agora
                configured
              </span>
              <span className={setup.inference ? "configured" : ""}>
                {setup.inference ? <Check size={13} /> : <X size={13} />}NVIDIA
                endpoint configured
              </span>
            </div>
            <p className="rule-detail">
              {setup.inferenceProvider === "hf-space" &&
                "Free Hugging Face GPU: shared queue and daily quota. Anonymous requests share this server’s allowance. Audio uploads are processed by the public Space. "}
              Configuration status does not verify service access. Setup: README
              + env.local.example. Audio attempts go to your configured server
              only for evaluation. No app-side recording storage. Voice
              recognition is imperfect; word match is not a pronunciation
              diagnosis.
            </p>
            <button className="small-cta" onClick={() => setSettings(false)}>
              {t("समझ गया!", "Got it!")}
              <Check size={17} />
            </button>
          </section>
        </div>
      )}
      {session && (
        <AgentSession
          credentials={session.credentials}
          rtm={session.rtm}
          muted={muted}
          onBridge={onBridge}
          onTrack={onTrack}
          onSpeech={onSpeech}
          onConnected={onConnected}
          onCaption={onCaption}
          onUser={onUser}
          onError={reportError}
        />
      )}
    </div>
  );
}

function WordDifferences({
  result,
  language,
}: {
  result: Evaluation;
  language: GameLanguage;
}) {
  const t = (hi: string, en: string) => (language === "en" ? en : hi);
  return (
    <div className="word-differences">
      <div>
        <span>{t("उम्मीद थी", "EXPECTED")}</span>
        <p>
          {result.differences
            .filter((item) => item.expected)
            .map((item, index) => (
              <span
                key={index}
                className={
                  item.kind === "match" ? "word-correct" : "word-wrong"
                }
              >
                {item.expected}{" "}
              </span>
            ))}
        </p>
      </div>
      <div>
        <span>{t("NVIDIA ने सुना", "NVIDIA HEARD")}</span>
        <p>{result.transcript}</p>
      </div>
    </div>
  );
}

function HostMascot({
  talking,
  large = false,
}: {
  talking: boolean;
  large?: boolean;
}) {
  return (
    <div
      className={`mascot ${talking ? "is-talking" : ""} ${large ? "large" : ""}`}
      aria-label="Chulbul, your friendly AI microphone host"
    >
      <svg
        viewBox="0 0 280 330"
        role="img"
        aria-label="Smiling cartoon microphone"
      >
        <ellipse
          cx="144"
          cy="306"
          rx="79"
          ry="13"
          fill="#241336"
          opacity=".15"
        />
        <path
          d="M94 208 Q40 190 31 217M204 206 Q247 171 260 192"
          fill="none"
          stroke="#251a30"
          strokeWidth="11"
          strokeLinecap="round"
        />
        <path
          d="M99 270 L92 298 L116 298M179 270 L191 298 L215 298"
          fill="none"
          stroke="#251a30"
          strokeWidth="13"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="71" y="39" width="139" height="237" rx="67" fill="#251a30" />
        <rect
          x="63"
          y="29"
          width="139"
          height="237"
          rx="67"
          fill="#ffcf35"
          stroke="#251a30"
          strokeWidth="7"
        />
        <path
          d="M82 72 Q133 53 184 72M78 89 Q133 70 189 89M76 107 Q133 90 191 107"
          fill="none"
          stroke="#d8a01c"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <rect
          x="76"
          y="116"
          width="113"
          height="76"
          rx="31"
          fill="#7139d4"
          stroke="#251a30"
          strokeWidth="5"
        />
        <ellipse cx="111" cy="149" rx="11" ry="15" fill="#fff8e6" />
        <ellipse cx="157" cy="149" rx="11" ry="15" fill="#fff8e6" />
        <circle cx="113" cy="152" r="5" fill="#251a30" />
        <circle cx="155" cy="152" r="5" fill="#251a30" />
        <path
          d="M123 174 Q134 183 146 173"
          fill="none"
          stroke="#fff8e6"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path
          className="mascot-mouth"
          d="M113 213 Q134 233 156 212 Q134 245 113 213"
          fill="#f54b78"
          stroke="#251a30"
          strokeWidth="4"
        />
        <circle cx="91" cy="204" r="8" fill="#ff8c61" />
        <circle cx="177" cy="204" r="8" fill="#ff8c61" />
        <path
          d="M91 45 Q130 17 173 45"
          fill="none"
          stroke="#fff5b8"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <path
          d="M224 63 L232 40M244 85 L265 78M224 109 L243 122"
          stroke="#251a30"
          strokeWidth="5"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
function HeadphoneMark() {
  return <ShieldCheck size={13} />;
}
