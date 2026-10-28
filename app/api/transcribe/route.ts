import { inferenceConfigured } from "@/lib/nemotron";
import { MAX_BYTES, type Style } from "@/lib/contracts";
import { boundedBody, json, sameOrigin } from "@/lib/http";
import { transcribe } from "@/lib/nemotron";
import { inspectWav } from "@/lib/wav";

export const runtime = "nodejs";
export const maxDuration = 240;

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return json({ error: "Cross-origin requests are not allowed." }, 403);
  const url = new URL(request.url);
  const style = url.searchParams.get("style") || "verbatim";
  const context = url.searchParams.get("context") || "";
  if (
    !["verbatim", "readable", "speakers"].includes(style) ||
    context.length > 400
  )
    return json(
      {
        error:
          "Choose a supported transcript style and at most 400 characters of vocabulary hints.",
      },
      400,
    );
  if (!request.headers.get("content-type")?.startsWith("audio/wav"))
    return json({ error: "Send audio/wav as the request body." }, 415);
  let bytes: Uint8Array;
  let duration: number;
  try {
    bytes = await boundedBody(request, MAX_BYTES);
    ({ duration } = inspectWav(bytes));
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Invalid audio." },
      error instanceof RangeError ? 413 : 400,
    );
  }
  if (!inferenceConfigured())
    return json(
      {
        error:
          "Connect a Nemotron inference server first. See the setup guide.",
      },
      503,
    );
  try {
    return json(
      await transcribe(
        bytes,
        duration,
        style as Style,
        context,
        url.searchParams.get("timestamps") === "true",
        request.signal,
      ),
    );
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      ["TimeoutError", "AbortError"].includes(error.name);
    return json(
      {
        error: timedOut
          ? "Inference timed out or was cancelled. Try a shorter recording and check the GPU server."
          : error instanceof Error
            ? error.message
            : "Transcription failed.",
      },
      timedOut ? 504 : 502,
    );
  }
}
