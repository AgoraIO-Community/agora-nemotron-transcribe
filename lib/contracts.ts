export const MODEL = "nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B";
export const MAX_SECONDS = 120;
export const SAMPLE_RATE = 16000;
export const MAX_BYTES = SAMPLE_RATE * 2 * MAX_SECONDS + 4096;
export type Style = "verbatim" | "readable" | "speakers";
export type Word = {
  word: string;
  start: number;
  end: number;
  speaker: string | null;
};
export type Transcript = {
  text: string;
  words: Word[];
  alignmentWarning: string | null;
  duration: number;
  processingMs: number;
  model: string;
  style: Style;
};
export type Credentials = {
  appId: string;
  token: string;
  uid: string;
  channel: string;
};
export type AudioInput = {
  id: string;
  track: MediaStreamTrack;
  enabled: boolean;
};
export type Setup = {
  agora: boolean;
  inference: boolean;
  model: string;
  inferenceProvider?: "hf-space" | "vllm";
};
export function participantName(uid: string | number) {
  return String(uid).split("~")[0] || "Participant";
}
export function clock(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)
    .toString()
    .padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
}
