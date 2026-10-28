import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import { encodeWav, inspectWav } from "../lib/wav";
import { boundedBody } from "../lib/http";
import { transcribe } from "../lib/nemotron";
import { toSrt } from "../lib/export";
import { POST } from "../app/api/transcribe/route";
import { GET } from "../app/api/generate-agora-token/route";

const wav = () => new Uint8Array(encodeWav(new Float32Array(16000).fill(0.1)));

test("PCM WAV round trip, exact clipping, duration and corrupt headers", () => {
  assert.equal(inspectWav(wav()).duration, 1);
  const clipped = new DataView(encodeWav(new Float32Array([-2, 2])));
  assert.equal(clipped.getInt16(44, true), -32768);
  assert.equal(clipped.getInt16(46, true), 32767);
  const broken = wav();
  broken[0] = 0;
  assert.throws(() => inspectWav(broken), /container/);
  const stereo = wav();
  new DataView(stereo.buffer).setUint16(22, 2, true);
  assert.throws(() => inspectWav(stereo), /mono/);
  assert.throws(
    () => inspectWav(new Uint8Array(encodeWav(new Float32Array(16000 * 121)))),
    /two minutes/,
  );
});

test("upload is bounded while streaming, without trusting Content-Length", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(8));
      controller.enqueue(new Uint8Array(8));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("http://localhost/api/transcribe", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit);
  await assert.rejects(boundedBody(request, 10), RangeError);
  assert.equal(cancelled, true);
});

test("routes reject cross-origin, bad media, missing configuration and invalid options before inference", async () => {
  assert.equal(
    (
      await POST(
        new Request("http://localhost/api/transcribe", {
          method: "POST",
          headers: { origin: "https://other.example" },
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await POST(
        new Request("http://localhost/api/transcribe", {
          method: "POST",
          body: "hello",
        }),
      )
    ).status,
    415,
  );
  assert.equal(
    (
      await POST(
        new Request("http://localhost/api/transcribe?style=unknown", {
          method: "POST",
        }),
      )
    ).status,
    400,
  );
  const prior = process.env.NEMOTRON_BASE_URL;
  delete process.env.NEMOTRON_BASE_URL;
  try {
    assert.equal(
      (
        await POST(
          new Request("http://localhost/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "audio/wav" },
            body: wav(),
          }),
        )
      ).status,
      503,
    );
  } finally {
    if (prior === undefined) delete process.env.NEMOTRON_BASE_URL;
    else process.env.NEMOTRON_BASE_URL = prior;
  }
});

test("adapter sends the NVIDIA chat-audio contract and validates alignment", async () => {
  process.env.NEMOTRON_BASE_URL = "http://127.0.0.1:8000/v1";
  const fake: typeof fetch = async (url, init) => {
    assert.equal(url, "http://127.0.0.1:8000/v1/chat/completions");
    const body = JSON.parse(init!.body as string);
    assert.equal(body.temperature, 0);
    assert.equal(body.chat_template_kwargs.enable_thinking, false);
    assert.equal(body.mm_processor_kwargs.capture_ctc_timestamps, true);
    assert.match(
      body.messages[0].content[1].audio_url.url,
      /^data:audio\/wav;base64,UklGR/,
    );
    assert.match(body.messages[0].content[0].text, /speaker tags/);
    return Response.json({
      choices: [
        { finish_reason: "stop", message: { content: "<spk:0>Hello world." } },
      ],
      ctc_timestamps: {
        error: null,
        words: [
          { word: "Hello", start: 0.1, end: 0.4, speaker: "<spk:0>" },
          { word: "invalid", start: -1, end: 99, speaker: null },
        ],
      },
    });
  };
  const result = await transcribe(
    wav(),
    1,
    "speakers",
    "Agora",
    true,
    new AbortController().signal,
    fake,
  );
  assert.equal(result.words.length, 1);
  assert.equal(result.alignmentWarning, null);
  assert.equal(result.text, "<spk:0>Hello world.");
  const noAlignment = await transcribe(
    wav(),
    1,
    "verbatim",
    "",
    true,
    new AbortController().signal,
    async () => Response.json({ choices: [{ message: { content: "hello" } }] }),
  );
  assert.equal(noAlignment.words.length, 0);
  assert.match(noAlignment.alignmentWarning!, /unavailable/);
});

test("adapter never treats truncation, provider errors, or empty responses as success", async () => {
  const call = (response: Response) =>
    transcribe(
      wav(),
      1,
      "verbatim",
      "",
      false,
      new AbortController().signal,
      async () => response,
    );
  await assert.rejects(
    call(
      Response.json({
        choices: [{ finish_reason: "length", message: { content: "partial" } }],
      }),
    ),
    /output limit/,
  );
  await assert.rejects(call(Response.json({ choices: [] })), /no transcript/);
  await assert.rejects(
    call(new Response("private provider error", { status: 401 })),
    /authentication failed/,
  );
});

test("Agora tokens preserve user account and channel, expire after an hour, and do not expose the certificate", async () => {
  const priorApp = process.env.NEXT_PUBLIC_AGORA_APP_ID;
  const priorCert = process.env.NEXT_AGORA_APP_CERTIFICATE;
  process.env.NEXT_PUBLIC_AGORA_APP_ID = "a".repeat(32);
  process.env.NEXT_AGORA_APP_CERTIFICATE = "b".repeat(32);
  try {
    const response = await GET(
      new Request(
        "http://localhost/api/generate-agora-token?channel=test-room&name=Akshay",
      ),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.uid, /^Akshay~/);
    assert.equal(body.channel, "test-room");
    assert.equal(body.certificate, undefined);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const require = createRequire(import.meta.url);
    const { AccessToken2 } = require("agora-token/src/AccessToken2");
    const parsed = new AccessToken2();
    parsed.from_string(body.token);
    assert.equal(parsed.expire, 3600);
    assert.equal(parsed.services[1].__channel_name.toString(), "test-room");
    assert.equal(parsed.services[1].__uid.toString(), body.uid);
    assert.equal(parsed.services[1].__privileges[1], 3600);
    const renewed = await GET(
      new Request(
        `http://localhost/api/generate-agora-token?channel=test-room&uid=${encodeURIComponent(body.uid)}`,
      ),
    );
    assert.equal((await renewed.json()).uid, body.uid);
    assert.equal(
      (
        await GET(
          new Request(
            "http://localhost/api/generate-agora-token?channel=../bad",
          ),
        )
      ).status,
      400,
    );
  } finally {
    if (priorApp === undefined) delete process.env.NEXT_PUBLIC_AGORA_APP_ID;
    else process.env.NEXT_PUBLIC_AGORA_APP_ID = priorApp;
    if (priorCert === undefined) delete process.env.NEXT_AGORA_APP_CERTIFICATE;
    else process.env.NEXT_AGORA_APP_CERTIFICATE = priorCert;
  }
});

test("SRT uses real seconds and separates speaker turns", () => {
  const srt = toSrt([
    { word: "hello", start: 0.125, end: 0.5, speaker: "0" },
    { word: "there", start: 0.6, end: 1.25, speaker: "1" },
  ]);
  assert.match(srt, /00:00:00,125 --> 00:00:00,500/);
  assert.match(srt, /\n2\n/);
});

test("bundled speech sample is nonempty valid inference-ready WAV", () => {
  const data = readFileSync(new URL("../public/sample.wav", import.meta.url));
  assert.ok(inspectWav(data).duration > 5);
});
