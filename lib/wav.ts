import { MAX_BYTES, MAX_SECONDS, SAMPLE_RATE } from "./contracts";

export function inspectWav(bytes: Uint8Array): { duration: number } {
  if (bytes.byteLength < 44 || bytes.byteLength > MAX_BYTES)
    throw new Error("Use a recording no longer than two minutes.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (
    text(0, 4) !== "RIFF" ||
    text(8, 4) !== "WAVE" ||
    view.getUint32(4, true) + 8 !== bytes.length
  )
    throw new Error("The WAV container is invalid.");
  let format = false;
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + size > bytes.length)
      throw new Error("The WAV recording is incomplete.");
    if (text(offset, 4) === "fmt ") {
      if (
        size < 16 ||
        view.getUint16(start, true) !== 1 ||
        view.getUint16(start + 2, true) !== 1 ||
        view.getUint32(start + 4, true) !== SAMPLE_RATE ||
        view.getUint16(start + 12, true) !== 2 ||
        view.getUint16(start + 14, true) !== 16 ||
        view.getUint32(start + 8, true) !== SAMPLE_RATE * 2
      )
        throw new Error("Use mono 16 kHz, 16-bit PCM WAV audio.");
      format = true;
    }
    if (text(offset, 4) === "data") dataBytes += size;
    offset = start + size + (size % 2);
  }
  const duration = dataBytes / (SAMPLE_RATE * 2);
  if (!format || dataBytes % 2 || duration < 0.25 || duration > MAX_SECONDS)
    throw new Error("Record between a quarter of a second and two minutes.");
  return { duration };
}

export function encodeWav(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(
      44 + index * 2,
      value < 0 ? value * 32768 : value * 32767,
      true,
    );
  });
  return buffer;
}

export async function normalizeAudio(blob: Blob): Promise<Blob> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (decoded.duration > MAX_SECONDS)
      throw new Error("Choose audio shorter than two minutes.");
    if (decoded.duration < 0.25) throw new Error("The recording is too short.");
    const renderer = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * SAMPLE_RATE),
      SAMPLE_RATE,
    );
    const source = renderer.createBufferSource();
    source.buffer = decoded;
    source.connect(renderer.destination);
    source.start();
    const audio = await renderer.startRendering();
    return new Blob([encodeWav(audio.getChannelData(0))], {
      type: "audio/wav",
    });
  } finally {
    await context.close();
  }
}
