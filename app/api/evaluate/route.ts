import { inferenceConfigured } from "@/lib/nemotron";
import { boundedBody, json, sameOrigin } from "@/lib/http";
import { inspectWav } from "@/lib/wav";
import { MAX_BYTES } from "@/lib/contracts";
import { twistersFor, evaluate, transcriptionInstruction } from "@/lib/game";
import { transcribe } from "@/lib/nemotron";
export const runtime = "nodejs";
export const maxDuration = 240;
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return json({ error: "Cross-origin request rejected." }, 403);
  const url = new URL(request.url),
    level = Number(url.searchParams.get("level"));
  const language = url.searchParams.get("language") || "hi";
  if (language !== "hi" && language !== "en")
    return json({ error: "Choose Hindi or English." }, 400);
  if (
    !url.searchParams.has("level") ||
    !Number.isInteger(level) ||
    !twistersFor(language)[level]
  )
    return json({ error: "Choose a valid level." }, 400);
  if (!request.headers.get("content-type")?.startsWith("audio/wav"))
    return json({ error: "Send a WAV recording." }, 415);
  let bytes, duration;
  try {
    bytes = await boundedBody(request, MAX_BYTES);
    ({ duration } = inspectWav(bytes));
    if (duration > 30)
      return json(
        { error: "Each attempt must be shorter than 30 seconds." },
        400,
      );
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Invalid recording." },
      error instanceof RangeError ? 413 : 400,
    );
  }
  if (!inferenceConfigured())
    return json(
      { error: "Nemotron is not configured. No score has been calculated." },
      503,
    );
  try {
    // Deliberately never pass the target phrase as an ASR prompt or context hint.
    const result = await transcribe(
      bytes,
      duration,
      "verbatim",
      "",
      true,
      request.signal,
      fetch,
      transcriptionInstruction(language),
    );
    const requestedSeconds = Number(url.searchParams.get("seconds"));
    const seconds =
      Number.isFinite(requestedSeconds) &&
      requestedSeconds >= 0.25 &&
      requestedSeconds <= duration + 1
        ? requestedSeconds
        : duration;
    return json({
      level,
      transcript: result.text,
      ...evaluate(level, result.text, seconds, language),
      speakingSeconds: seconds,
      words: result.words,
      alignmentWarning: result.alignmentWarning,
      processingMs: result.processingMs,
    });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to evaluate this attempt. No score was assigned.",
      },
      502,
    );
  }
}
