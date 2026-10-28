import { transcribeSpace } from "./hf-space";
import { MODEL, type Style, type Transcript, type Word } from "./contracts";

export function promptFor(style: Style, context: string) {
  const prompts: Record<Style, string> = {
    verbatim:
      "Transcribe verbatim in the original spoken languages. Preserve all spoken words, fillers, repetitions, corrections and language switches. Add punctuation and capitalization. Return only the transcript.",
    readable:
      "Transcribe in the original spoken languages. Omit fillers and accidental repetitions, but preserve the remaining spoken wording and corrections. Add punctuation and capitalization. Return only the transcript.",
    speakers:
      "Transcribe this audio with punctuation and capitalization. Include all spoken words and verbal fillers. Write numbers in their standard written form. Put speaker tags <spk:0> <spk:1> <spk:2> <spk:3> on the transcription. Return only the transcript.",
  };
  return (
    prompts[style] +
    (context ? ` Context terms (vocabulary hints only): ${context}.` : "")
  );
}

export function inferenceConfigured() {
  return (
    process.env.NEMOTRON_PROVIDER === "hf-space" ||
    Boolean(process.env.NEMOTRON_BASE_URL)
  );
}

export function inferenceConfig() {
  const provider = process.env.NEMOTRON_PROVIDER || "vllm";
  if (provider !== "vllm" && provider !== "hf-space")
    throw new Error("Choose NEMOTRON_PROVIDER=hf-space or vllm.");
  if (provider === "hf-space")
    return { provider, base: "", model: MODEL, key: undefined };
  const raw = process.env.NEMOTRON_BASE_URL?.trim();
  if (!raw)
    throw new Error(
      "Set NEMOTRON_BASE_URL in .env.local to your running NeMo/vLLM server.",
    );
  const url = new URL(raw);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "NEMOTRON_BASE_URL must be an HTTP(S) API base URL without credentials or query parameters.",
    );
  return {
    provider,
    base: raw.replace(/\/$/, ""),
    model: process.env.NEMOTRON_MODEL?.trim() || MODEL,
    key: process.env.NEMOTRON_API_KEY?.trim(),
  };
}

export async function transcribe(
  bytes: Uint8Array,
  duration: number,
  style: Style,
  context: string,
  timestamps: boolean,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  instruction?: string,
): Promise<Transcript> {
  const config = inferenceConfig();
  if (config.provider === "hf-space")
    return transcribeSpace(
      bytes,
      duration,
      style,
      instruction || promptFor(style, context),
      signal,
      fetcher,
    );
  const started = performance.now();
  const response = await fetcher(`${config.base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.key ? { Authorization: `Bearer ${config.key}` } : {}),
    },
    signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: instruction || promptFor(style, context) },
            {
              type: "audio_url",
              audio_url: {
                url: `data:audio/wav;base64,${Buffer.from(bytes).toString("base64")}`,
              },
            },
          ],
        },
      ],
      temperature: 0,
      top_p: 1,
      seed: 0,
      max_tokens: 8192,
      stream: false,
      n: 1,
      chat_template_kwargs: { enable_thinking: false },
      skip_special_tokens: false,
      spaces_between_special_tokens: false,
      ...(timestamps
        ? { mm_processor_kwargs: { capture_ctc_timestamps: true } }
        : {}),
    }),
  });
  if (!response.ok) {
    if ([401, 403].includes(response.status))
      throw new Error(
        "Inference authentication failed. Check the server-side NEMOTRON_API_KEY.",
      );
    if (response.status === 429)
      throw new Error(
        "The inference server is busy. Please try again shortly.",
      );
    throw new Error(
      `Inference returned HTTP ${response.status}. Check the NeMo plugin, served model name, and GPU server logs.`,
    );
  }
  const data = await response.json();
  const choice = data.choices?.[0];
  if (choice?.finish_reason === "length")
    throw new Error(
      "The model reached its output limit. Try a shorter recording.",
    );
  const text = choice?.message?.content;
  if (typeof text !== "string" || !text.trim())
    throw new Error(
      "The model returned no transcript. Check that the recording contains speech.",
    );
  const alignment = data.ctc_timestamps;
  let alignmentWarning: string | null = null;
  const words: Word[] = [];
  if (timestamps) {
    if (!alignment || alignment.error || !Array.isArray(alignment.words))
      alignmentWarning =
        "Word alignment is unavailable. The transcript is still usable; check the NeMo CTC middleware and V1 model runner.";
    else {
      for (const word of alignment.words) {
        if (
          typeof word.word === "string" &&
          Number.isFinite(word.start) &&
          Number.isFinite(word.end) &&
          word.start >= 0 &&
          word.end >= word.start &&
          word.end <= duration + 1
        )
          words.push({
            word: word.word,
            start: word.start,
            end: word.end,
            speaker:
              typeof word.speaker === "string" ||
              typeof word.speaker === "number"
                ? String(word.speaker)
                : null,
          });
      }
      if (!words.length)
        alignmentWarning = "The model returned no usable word timestamps.";
    }
  }
  return {
    text: text.trim(),
    words,
    alignmentWarning,
    duration,
    processingMs: Math.round(performance.now() - started),
    model: config.model,
    style,
  };
}
