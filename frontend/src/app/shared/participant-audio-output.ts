/** One audible path per participant. Gain is applied to PCM, not just the
 * media element volume (which some mobile playback implementations ignore).
 * The processed stream still plays through an element to retain setSinkId and
 * native audio routing. Never connect this graph to context.destination too.
 */
let context: AudioContext | null = null;
function audioContext(): AudioContext {
  if (!context || context.state === 'closed') {
    context = new AudioContext();
    const resume = () => { if (context?.state === 'suspended') void context.resume().catch(() => {}); };
    window.addEventListener('pointerdown', resume, {capture: true});
    window.addEventListener('keydown', resume, {capture: true});
  }
  return context;
}

export class ParticipantAudioOutput {
  private sources: MediaStreamAudioSourceNode[] = [];
  private gain: GainNode | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private volume = 1;
  private inputTracks: MediaStreamTrack[] = [];
  private decoders: HTMLAudioElement[] = [];
  constructor(readonly element: HTMLAudioElement) {}

  setStream(stream: MediaStream): void {
    const tracks = stream.getAudioTracks();
    if (this.destination && tracks.length === this.inputTracks.length && tracks.every((track,i) => track === this.inputTracks[i])) return;
    this.disconnectGraph();
    this.inputTracks = tracks;
    const ctx = audioContext();
    this.gain = ctx.createGain();
    this.destination = ctx.createMediaStreamDestination();
    this.gain.connect(this.destination);
    // A MediaStream source selects only one audio track. Mix explicit sources
    // so microphone and shared-screen audio coexist and share personal gain.
    for (const track of tracks) {
      // Chromium needs a playing raw media element to pull/decode WebRTC
      // receivers for Web Audio. Keep it permanently silent; only the processed
      // output is audible. One decoder per track also covers screen-share sound.
      const decoder = new Audio();
      decoder.muted = true;
      decoder.volume = 0;
      decoder.srcObject = new MediaStream([track]);
      this.decoders.push(decoder);
      const source = ctx.createMediaStreamSource(new MediaStream([track]));
      source.connect(this.gain); this.sources.push(source);
    }
    this.element.srcObject = this.destination.stream;
    this.setVolume(this.volume);
  }

  setVolume(value: number): void {
    if (!Number.isFinite(value)) return;
    this.volume = Math.max(0, Math.min(1, value));
    if (this.gain) this.gain.gain.value = this.volume;
    this.element.volume = this.gain ? 1 : this.volume;
    this.element.muted = this.volume === 0;
    if (context?.state === 'suspended') void context.resume().catch(() => {});
  }

  async play(): Promise<void> {
    if (context?.state === 'suspended') void context.resume().catch(() => {});
    await Promise.all(this.decoders.map(decoder => decoder.play()));
    await this.element.play();
  }

  private disconnectGraph(): void {
    this.decoders.forEach(decoder => { decoder.pause(); decoder.srcObject = null; });
    this.decoders = [];
    this.inputTracks = [];
    this.sources.forEach(source => source.disconnect()); this.sources = [];
    this.gain?.disconnect(); this.gain = null;
    this.destination?.stream.getTracks().forEach(track => track.stop()); this.destination = null;
  }

  dispose(): void {
    this.element.pause(); this.element.srcObject = null; this.disconnectGraph();
    // Do not stop input tracks: LiveKit owns them.
  }
}
