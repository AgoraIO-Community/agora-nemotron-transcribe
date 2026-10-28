import { CallCapture } from "./capture";
import { encodeWav, inspectWav } from "./wav";
import { SAMPLE_RATE } from "./contracts";

export class AttemptCapture {
  private recorder = new CallCapture();
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private frame = 0;
  private first = 0;
  private last = 0;
  private startTime = 0;
  private ended = false;
  private cancelled = false;
  private voicedFrames = 0;
  constructor(
    private onMeter: (value: number, elapsed: number) => void,
    private onFinish: (blob: Blob, seconds: number) => void,
    private onError: (message: string) => void,
  ) {}

  async arm(track: MediaStreamTrack) {
    try {
      await this.recorder.start([{ id: "player", track, enabled: true }]);
      if (this.cancelled) return;
      this.startTime = performance.now();
      this.context = new AudioContext();
      await this.context.resume();
      this.source = this.context.createMediaStreamSource(
        new MediaStream([track]),
      );
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.source.connect(this.analyser);
      const samples = new Float32Array(this.analyser.fftSize);
      const read = () => {
        if (this.ended || !this.analyser) return;
        this.analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(
          samples.reduce((sum, value) => sum + value * value, 0) /
            samples.length,
        );
        const now = performance.now();
        if (rms > 0.018) {
          this.voicedFrames++;
          if (!this.first) this.first = now;
          this.last = now;
        }
        this.onMeter(
          Math.min(1, rms * 12),
          this.first ? (now - this.first) / 1000 : 0,
        );
        if (
          (this.first && this.voicedFrames > 6 && now - this.last > 1150) ||
          now - this.startTime > 27000
        )
          this.stop();
        else this.frame = requestAnimationFrame(read);
      };
      this.frame = requestAnimationFrame(read);
      void this.recorder.result
        .then(async (blob) => {
          if (this.cancelled) return;
          if (!this.first || this.voicedFrames < 6) {
            this.onError(
              "आवाज़ सुनाई नहीं दी। माइक के पास बोलकर फिर कोशिश करो।",
            );
            return;
          }
          const bytes = new Uint8Array(await blob.arrayBuffer());
          inspectWav(bytes);
          const data = new DataView(bytes.buffer);
          // CallCapture always emits a canonical 44-byte PCM header.
          const start = Math.max(
            0,
            Math.floor(
              ((this.first - this.startTime - 200) / 1000) * SAMPLE_RATE,
            ),
          );
          const end = Math.min(
            (bytes.length - 44) / 2,
            Math.ceil(
              ((this.last - this.startTime + 200) / 1000) * SAMPLE_RATE,
            ),
          );
          const samples = new Float32Array(Math.max(0, end - start));
          for (let index = 0; index < samples.length; index++)
            samples[index] =
              data.getInt16(44 + (start + index) * 2, true) / 32768;
          if (!this.cancelled)
            this.onFinish(
              new Blob([encodeWav(samples)], { type: "audio/wav" }),
              Math.max(0.25, (this.last - this.first) / 1000),
            );
        })
        .catch((error) => {
          if (!this.cancelled) {
            this.cancel();
            this.onError(
              error instanceof Error ? error.message : "Recording failed.",
            );
          }
        });
    } catch (error) {
      if (this.cancelled) return;
      this.cancel();
      this.onError(
        error instanceof Error
          ? error.message
          : "Microphone recording unavailable.",
      );
    }
  }
  stop() {
    if (this.ended) return;
    this.ended = true;
    this.recorder.stop();
    this.cleanup();
  }
  cancel() {
    this.cancelled = true;
    this.ended = true;
    this.recorder.cancel();
    this.cleanup();
  }
  private cleanup() {
    cancelAnimationFrame(this.frame);
    this.source?.disconnect();
    if (this.context && this.context.state !== "closed")
      void this.context.close();
  }
}
