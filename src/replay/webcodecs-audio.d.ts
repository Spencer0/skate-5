// The WebCodecs audio half is missing from TypeScript's DOM lib; just what the exporter uses.

interface AudioEncoderConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  bitrate?: number;
}

interface EncodedAudioChunk {
  readonly type: 'key' | 'delta';
  readonly timestamp: number;
  readonly duration: number | null;
  readonly byteLength: number;
  copyTo(destination: AllowSharedBufferSource): void;
}

interface EncodedAudioChunkMetadata {
  decoderConfig?: { codec: string; sampleRate: number; numberOfChannels: number; description?: AllowSharedBufferSource };
}

interface AudioDataInit {
  format: 'f32-planar' | 'f32' | 's16' | 's16-planar';
  sampleRate: number;
  numberOfFrames: number;
  numberOfChannels: number;
  timestamp: number;
  data: AllowSharedBufferSource;
}

declare class AudioData {
  constructor(init: AudioDataInit);
  close(): void;
}

declare class AudioEncoder {
  constructor(init: { output: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void; error: (e: DOMException) => void });
  static isConfigSupported(config: AudioEncoderConfig): Promise<{ supported?: boolean }>;
  configure(config: AudioEncoderConfig): void;
  encode(data: AudioData): void;
  flush(): Promise<void>;
  close(): void;
}
