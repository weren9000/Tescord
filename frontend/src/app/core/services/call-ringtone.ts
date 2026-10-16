/** Small original call tones; unlock audio on the user's first interaction. */
export class CallRingtone {
  private context: AudioContext | null = null;
  private mode: 'incoming' | 'outgoing' | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private voices: OscillatorNode[] = [];
  private installed = false;
  private readonly unlock = () => {
    if (!this.context) this.context = new AudioContext();
    void this.context.resume().then(() => {if (this.mode && !this.timer) this.tick();}).catch(() => {});
  };
  install(): void {
    if (this.installed || typeof AudioContext === 'undefined') return;
    this.installed = true;
    document.addEventListener('pointerdown', this.unlock, true);
    document.addEventListener('keydown', this.unlock, true);
  }
  start(mode: 'incoming' | 'outgoing'): void {
    this.stop(); this.mode = mode;
    if (typeof AudioContext !== 'undefined') this.unlock();
  }
  stop(): void {
    this.mode = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const voice of this.voices) {try {voice.stop();} catch {} voice.disconnect();}
    this.voices = [];
  }
  dispose(): void {
    this.stop();
    document.removeEventListener('pointerdown', this.unlock, true);
    document.removeEventListener('keydown', this.unlock, true);
    this.installed = false;
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
  }
  private tick(): void {
    const context = this.context;
    if (!context || context.state !== 'running' || !this.mode || this.timer) return;
    const notes = this.mode === 'incoming' ? [660,880,660,990] : [440,440];
    notes.forEach((frequency,index) => {
      const voice=context.createOscillator(), gain=context.createGain(), at=context.currentTime+index*.23;
      voice.frequency.value=frequency; gain.gain.setValueAtTime(0,at);
      gain.gain.linearRampToValueAtTime(.055,at+.018);gain.gain.exponentialRampToValueAtTime(.0001,at+.19);
      voice.connect(gain);gain.connect(context.destination);this.voices.push(voice);
      voice.onended=()=>{voice.disconnect();gain.disconnect();this.voices=this.voices.filter(v=>v!==voice);};
      voice.start(at);voice.stop(at+.2);
    });
    this.timer=setTimeout(()=>{this.timer=null;this.tick();},this.mode==='incoming'?2600:3400);
  }
}
