import { MODEL, type Style, type Transcript } from "./contracts";

// Public Gradio API and app.py verified against the linked Space, 29 October 2026.
export const FREE_SPACE =
  "https://hugging-apps-nemotron-3-5-transcribe.hf.space";
const MAX_OUTPUT_TOKENS = 1024;
export function freeSpaceHeaders(): Record<string, string> {
  const token = process.env.HF_TOKEN?.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
export function spaceError(detail: unknown): Error {
  const message =
    typeof detail === "string" ? detail : JSON.stringify(detail ?? "");
  if (/quota|exceeded.*GPU|GPU.*exceeded|remaining.*GPU/i.test(message))
    return new Error(
      "Hugging Face’s free GPU quota is exhausted. Wait for it to reset, or configure your own free-account HF_TOKEN. No score was calculated.",
    );
  if (/sign.?in|log.?in|authentication|unauthori[sz]ed/i.test(message))
    return new Error(
      "Hugging Face requires sign-in for this request. Configure a server-side HF_TOKEN from your free Hugging Face account. No score was calculated.",
    );
  return new Error(
    "The free Hugging Face GPU is busy or unavailable. Try again later. No score was calculated.",
  );
}
export function spaceTranscript(output: unknown): string {
  if (typeof output !== "string")
    throw new Error(
      "The free Space returned no transcript. No score was calculated.",
    );
  // The final yield includes metrics. Partial generator updates must never become scores.
  const final = output.match(
    /\n\n<sub>[^<]*?(\d+) output tokens[^<]*total [^<]*<\/sub>\s*$/,
  );
  if (!final)
    throw new Error(
      "The free Space returned an incomplete response. No score was calculated.",
    );
  if (Number(final[1]) >= MAX_OUTPUT_TOKENS)
    throw new Error(
      "The free Space reached its output limit. Retry with a shorter recording. No score was calculated.",
    );
  const text = output
    .slice(0, final.index)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
  if (!text)
    throw new Error(
      "No speech transcript was returned. Try speaking near the microphone.",
    );
  return text;
}

export async function transcribeSpace(
  bytes: Uint8Array,
  duration: number,
  style: Style,
  instruction: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Transcript> {
  const started = performance.now();
  const combined = AbortSignal.any([signal, AbortSignal.timeout(210_000)]);
  const headers = freeSpaceHeaders();
  const form = new FormData();
  form.append(
    "files",
    new Blob([new Uint8Array(bytes)], { type: "audio/wav" }),
    "attempt.wav",
  );
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const upload = await fetcher(`${FREE_SPACE}/gradio_api/upload`, {
      method: "POST",
      headers,
      body: form,
      signal: combined,
    });
    if (!upload.ok)
      throw spaceError(
        upload.status === 401 || upload.status === 403
          ? "authentication"
          : "upload unavailable",
      );
    const paths = await upload.json();
    if (!Array.isArray(paths) || typeof paths[0] !== "string")
      throw new Error(
        "The free Space did not accept the recording. No score was calculated.",
      );
    const queued = await fetcher(`${FREE_SPACE}/gradio_api/call/transcribe`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      signal: combined,
      body: JSON.stringify({
        data: [
          { path: paths[0], meta: { _type: "gradio.FileData" } },
          instruction,
          false,
          0,
          MAX_OUTPUT_TOKENS,
        ],
      }),
    });
    if (!queued.ok)
      throw spaceError(
        queued.status === 401 || queued.status === 403
          ? "authentication"
          : "queue unavailable",
      );
    const { event_id: eventId } = await queued.json();
    if (typeof eventId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(eventId))
      throw new Error(
        "The free GPU queue did not accept this attempt. No score was calculated.",
      );
    const stream = await fetcher(
      `${FREE_SPACE}/gradio_api/call/transcribe/${eventId}`,
      { headers, signal: combined },
    );
    if (!stream.ok || !stream.body) throw spaceError("stream unavailable");
    reader = stream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "",
      count = 0;
    while (true) {
      const { value, done } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      count += value?.length || 0;
      if (count > 2_000_000)
        throw new Error(
          "The free Space response was too large. No score was calculated.",
        );
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const kind = event
          .split("\n")
          .find((line) => line.startsWith("event:"))
          ?.slice(6)
          .trim();
        const raw = event
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (kind !== "complete" && kind !== "error") continue;
        let data: unknown;
        try {
          data = JSON.parse(raw);
        } catch {
          throw new Error(
            "The free Space returned an invalid response. No score was calculated.",
          );
        }
        if (kind === "error") throw spaceError(data);
        const text = spaceTranscript(Array.isArray(data) ? data[0] : null);
        return {
          text,
          words: [],
          duration,
          style,
          model: MODEL,
          processingMs: Math.round(performance.now() - started),
          alignmentWarning:
            "The free Hugging Face Space returns transcript text without word timestamps. Speaking time is measured locally.",
        };
      }
      if (done)
        throw new Error(
          "The free Space disconnected before completing the attempt. No score was calculated.",
        );
    }
  } catch (error) {
    if (combined.aborted && !signal.aborted)
      throw new Error(
        "The free GPU queue took too long. Try again later. No score was calculated.",
      );
    if (error instanceof TypeError) throw spaceError("network unavailable");
    throw error;
  } finally {
    await reader?.cancel().catch(() => {});
  }
}
