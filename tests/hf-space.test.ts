import assert from "node:assert/strict";
import test from "node:test";
import { FREE_SPACE, spaceTranscript, transcribeSpace } from "../lib/hf-space";
import { MODEL } from "../lib/contracts";
import { encodeWav } from "../lib/wav";
import { POST } from "../app/api/evaluate/route";
import { GET } from "../app/api/readiness/route";
const final = (text: string, tokens = 12) =>
  `${text}\n\n<sub>2.0s audio · 25 audio tokens · ${tokens} output tokens · encode 0.8s · decode 0.7s (17.3 tok/s) · total 1.5s</sub>`;
function sse(events: string) {
  const bytes = new TextEncoder().encode(events);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 3)
          controller.enqueue(bytes.slice(i, i + 3));
        controller.close();
      },
    }),
  );
}
function fakeSpace(
  events: string,
  inspect?: (body: unknown[]) => void,
): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    assert.ok(url.startsWith(FREE_SPACE + "/"), "No paid-provider fallback");
    if (url.endsWith("/upload")) {
      assert.ok(init?.body instanceof FormData);
      return Response.json(["/tmp/gradio/test/attempt.wav"]);
    }
    if (url.endsWith("/call/transcribe")) {
      inspect?.(JSON.parse(init!.body as string).data);
      return Response.json({ event_id: "test-event" });
    }
    return sse(events);
  };
}
const audio = new Uint8Array(encodeWav(new Float32Array(32000).fill(0.1)));

test("free Space uploads audio and only trusts final SSE output, including split Unicode", async () => {
  const previous = process.env.NEMOTRON_API_KEY;
  process.env.NEMOTRON_API_KEY = "must-not-go-to-hugging-face";
  try {
    const response = await transcribeSpace(
      audio,
      2,
      "verbatim",
      "Neutral Hindi instruction",
      new AbortController().signal,
      fakeSpace(
        `event: generating\ndata: ["partial"]\n\nevent: heartbeat\ndata: null\n\nevent: complete\ndata: ${JSON.stringify([final("कच्चा पापड़")])}\n\n`,
        (data) => {
          assert.equal(data[1], "Neutral Hindi instruction");
          assert.equal(data[2], false);
          assert.equal(data[3], 0);
        },
      ),
    );
    assert.equal(response.text, "कच्चा पापड़");
    assert.equal(response.model, MODEL);
    assert.deepEqual(response.words, []);
    assert.match(response.alignmentWarning!, /without word timestamps/);
  } finally {
    if (previous === undefined) delete process.env.NEMOTRON_API_KEY;
    else process.env.NEMOTRON_API_KEY = previous;
  }
});

test("free Space quota errors never become scores or paid fallbacks", async () => {
  await assert.rejects(
    transcribeSpace(
      audio,
      2,
      "verbatim",
      "Transcribe",
      new AbortController().signal,
      fakeSpace(
        'event: generating\ndata: ["partial"]\n\nevent: error\ndata: "You have exceeded your GPU quota"\n\n',
      ),
    ),
    /quota is exhausted/,
  );
  await assert.rejects(
    transcribeSpace(
      audio,
      2,
      "verbatim",
      "Transcribe",
      new AbortController().signal,
      fakeSpace('event: generating\ndata: ["partial"]\n\n'),
    ),
    /disconnected before completing/,
  );
});

test("free Space rejects incomplete, empty and token-limited output", () => {
  assert.throws(() => spaceTranscript("partial"), /incomplete/);
  assert.throws(() => spaceTranscript(final("", 0)), /No speech transcript/);
  assert.throws(() => spaceTranscript(final("cut off", 1024)), /output limit/);
  assert.equal(spaceTranscript(final("&lt;spk:0&gt; hello")), "<spk:0> hello");
});

test("cancelling an attempt aborts free Space network requests", async () => {
  const controller = new AbortController();
  controller.abort();
  const abortingFetch: typeof fetch = async (_url, init) => {
    assert.equal(init!.signal!.aborted, true);
    throw init!.signal!.reason;
  };
  await assert.rejects(
    transcribeSpace(
      audio,
      2,
      "verbatim",
      "Transcribe",
      controller.signal,
      abortingFetch,
    ),
    (error) => error instanceof Error && error.name === "AbortError",
  );
});

test("free provider readiness and real evaluation contract work without a vLLM base URL", async () => {
  const previousProvider = process.env.NEMOTRON_PROVIDER,
    previousBase = process.env.NEMOTRON_BASE_URL,
    previousFetch = globalThis.fetch;
  process.env.NEMOTRON_PROVIDER = "hf-space";
  delete process.env.NEMOTRON_BASE_URL;
  try {
    globalThis.fetch = async () =>
      Response.json({
        named_endpoints: {
          "/transcribe": { parameters: [{ parameter_name: "instruction" }] },
        },
      });
    const ready = await GET(new Request("http://localhost/api/readiness"));
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).provider, "hf-space");
    globalThis.fetch = fakeSpace(
      `event: complete\ndata: ${JSON.stringify([final("Red lorry, yellow lorry.")])}\n\n`,
      (data) => {
        assert.match(String(data[1]), /English speech/);
        assert.equal(String(data[1]).includes("Red lorry"), false);
      },
    );
    const response = await POST(
      new Request(
        "http://localhost/api/evaluate?level=0&language=en&seconds=1.5",
        {
          method: "POST",
          headers: { "Content-Type": "audio/wav" },
          body: audio,
        },
      ),
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.score, 1000);
    assert.equal(result.match, 100);
    globalThis.fetch = async () => Response.json({ named_endpoints: {} });
    assert.equal(
      (await GET(new Request("http://localhost/api/readiness"))).status,
      503,
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousProvider === undefined) delete process.env.NEMOTRON_PROVIDER;
    else process.env.NEMOTRON_PROVIDER = previousProvider;
    if (previousBase === undefined) delete process.env.NEMOTRON_BASE_URL;
    else process.env.NEMOTRON_BASE_URL = previousBase;
  }
});
