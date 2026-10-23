import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { Audio } from '../audio';
import { FPS, Sfx } from './clip';

/**
 * Frame-exact MP4 export: the caller draws each frame on its own clock, we
 * hand it to the browser's hardware encoder (WebCodecs) and box the result
 * with mp4-muxer. Sound is re-synthesized offline from the recorded events.
 */

export const FORMATS = [
  { id: 'landscape', name: 'Landscape 720p', w: 1280, h: 720 },
  { id: 'portrait', name: 'Portrait 720p', w: 720, h: 1280 },
  { id: 'hd', name: 'Landscape 1080p', w: 1920, h: 1080 },
] as const;
export type Format = (typeof FORMATS)[number];

export const canExport = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

type VCodec = { muxer: 'avc' | 'vp9' | 'av1'; codec: string };
const VIDEO: VCodec[] = [
  { muxer: 'avc', codec: 'avc1.640028' }, // H.264 High 4.0: plays everywhere
  { muxer: 'avc', codec: 'avc1.4d0028' },
  { muxer: 'avc', codec: 'avc1.42e01f' },
  { muxer: 'vp9', codec: 'vp09.00.40.08' },
  { muxer: 'av1', codec: 'av01.0.08M.08' },
];

async function pickVideo(w: number, h: number) {
  for (const v of VIDEO) {
    const config: VideoEncoderConfig = { codec: v.codec, width: w, height: h, bitrate: Math.round(w * h * FPS * 0.2), framerate: FPS };
    if (v.muxer === 'avc') config.avc = { format: 'avc' };
    try {
      const s = await VideoEncoder.isConfigSupported(config);
      if (s.supported) return { v, config };
    } catch {
      /* try the next one */
    }
  }
  return null;
}

const RATE = 48000;
async function pickAudio() {
  if (typeof AudioEncoder === 'undefined' || typeof OfflineAudioContext === 'undefined') return null;
  for (const [muxer, codec] of [
    ['aac', 'mp4a.40.2'],
    ['opus', 'opus'],
  ] as const) {
    const config: AudioEncoderConfig = { codec, sampleRate: RATE, numberOfChannels: 2, bitrate: 128000 };
    try {
      const s = await AudioEncoder.isConfigSupported(config);
      if (s.supported) return { muxer, config };
    } catch {
      /* try the next one */
    }
  }
  return null;
}

/** Synthesize the edit's sounds: one-shots at their times plus the rolling / grinding beds. */
export async function renderSound(duration: number, sfx: Sfx[], bed: (t: number) => readonly number[]) {
  const ctx = new OfflineAudioContext(2, Math.ceil((duration + 0.5) * RATE), RATE);
  const a = Audio.offline(ctx);
  const play = a as unknown as Record<string, (...x: unknown[]) => void>;
  for (let t = 0; t <= duration; t += 1 / FPS) {
    a.at = t;
    const s = bed(t);
    a.update(s[0], s[1] === 2 ? 'slide' : s[1] === 1 ? 'grind' : 'none', s[2], s[3] > 0.5);
  }
  // fade the beds out with the picture
  a.at = duration;
  a.update(0, 'none', 0, false);
  for (const x of sfx) {
    a.at = x.t;
    play[x.n]?.(...x.a);
  }
  return ctx.startRendering();
}

export interface ExportJob {
  format: Format;
  duration: number;
  /** draw output frame i (time i / FPS) and return the canvas to encode */
  draw(i: number): HTMLCanvasElement | OffscreenCanvas | Promise<HTMLCanvasElement | OffscreenCanvas>;
  sound: () => Promise<AudioBuffer | null>;
  progress(p: number, label: string): void;
  cancelled(): boolean;
}

export async function exportMp4(job: ExportJob): Promise<Blob | null> {
  const { w, h } = job.format;
  const vid = await pickVideo(w, h);
  if (!vid) throw new Error('This browser cannot encode video. Try Chrome, Edge or Safari 17+.');
  const aud = await pickAudio();

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: vid.v.muxer, width: w, height: h, frameRate: FPS },
    audio: aud ? { codec: aud.muxer, numberOfChannels: 2, sampleRate: RATE } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  let failure: unknown = null;
  const venc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failure = e),
  });
  venc.configure(vid.config);

  const frames = Math.max(1, Math.round(job.duration * FPS));
  const us = 1e6 / FPS;
  for (let i = 0; i < frames; i++) {
    if (job.cancelled()) {
      venc.close();
      return null;
    }
    if (failure) throw failure;
    const canvas = await job.draw(i);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * us), duration: Math.round(us) });
    venc.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
    frame.close();
    // keep the encoder queue short so memory stays flat on long edits
    while (venc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1));
    if (i % 3 === 0) {
      job.progress((i / frames) * 0.92, `Rendering frame ${i + 1} of ${frames}`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  await venc.flush();
  venc.close();
  if (failure) throw failure;

  if (aud) {
    job.progress(0.94, 'Mixing sound');
    const buf = await job.sound();
    if (buf && !job.cancelled()) {
      const aenc = new AudioEncoder({
        output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
        error: (e) => (failure = e),
      });
      aenc.configure(aud.config);
      const total = Math.min(buf.length, Math.round(job.duration * RATE));
      const L = buf.getChannelData(0);
      const R = buf.getChannelData(buf.numberOfChannels > 1 ? 1 : 0);
      const N = 4800;
      for (let o = 0; o < total; o += N) {
        const n = Math.min(N, total - o);
        const planar = new Float32Array(n * 2);
        planar.set(L.subarray(o, o + n), 0);
        planar.set(R.subarray(o, o + n), n);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((o / RATE) * 1e6), data: planar });
        aenc.encode(ad);
        ad.close();
      }
      await aenc.flush();
      aenc.close();
      if (failure) throw failure;
    }
  }
  if (job.cancelled()) return null;
  job.progress(0.99, 'Saving');
  muxer.finalize();
  return new Blob([target.buffer], { type: 'video/mp4' });
}
