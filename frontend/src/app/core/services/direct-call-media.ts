import {computed, signal} from '@angular/core';
import type {Room, LocalAudioTrack, LocalVideoTrack, RemoteTrack, Track} from 'livekit-client';
import {SFU_BASE_URL, VOICE_ICE_SERVERS} from '../api/api-base';
import {prepareInlineMediaElement, requestCameraStream} from '../../shared/media-device.utils';

export type DirectCallState = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'connected';

/** LiveKit transport with the same publication sources and connection options as group calls. */
export abstract class DirectCallMedia {
  protected room: Room | null = null;
  private sdk: typeof import('livekit-client') | null = null;
  protected mediaGeneration = 0;
  private localStream: MediaStream | null = null;
  private localAudioTrack: LocalAudioTrack | null = null;
  private cameraTrack: LocalVideoTrack | null = null;
  private screenTrack: LocalVideoTrack | null = null;
  private remoteAudioElement: HTMLAudioElement | null = null;
  private cameraBusy = false;
  private screenBusy = false;
  private readonly unlockAudio = () => {void this.playAudio();};

  readonly state = signal<DirectCallState>('idle');
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly localCameraStream = signal<MediaStream | null>(null);
  readonly remoteCameraStream = signal<MediaStream | null>(null);
  readonly localScreenStream = signal<MediaStream | null>(null);
  readonly remoteScreenStream = signal<MediaStream | null>(null);
  readonly localMuted = signal(false);
  readonly remoteVolume = signal(100);
  readonly outputMuted = signal(false);
  readonly inputDeviceId = signal<string | null>(null);
  readonly outputDeviceId = signal<string | null>(null);
  readonly cameraDeviceId = signal<string | null>(null);
  readonly deviceChanging = signal(false);
  readonly deviceNotice = signal<string | null>(null);
  readonly cameraSupported = computed(() => !!navigator.mediaDevices?.getUserMedia);
  readonly screenShareSupported = computed(() => !!navigator.mediaDevices?.getDisplayMedia);
  readonly isCameraEnabled = computed(() => this.localCameraStream() !== null);
  readonly hasRemoteCamera = computed(() => this.remoteCameraStream() !== null);
  readonly isScreenSharing = computed(() => this.localScreenStream() !== null);
  readonly hasRemoteScreenShare = computed(() => this.remoteScreenStream() !== null);
  readonly hasActiveCall = computed(() => this.state() !== 'idle');

  protected abstract mediaFailed(message: string): void;

  private microphoneConstraints(deviceId: string | null): MediaTrackConstraints {
    return {echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      ...(deviceId ? {deviceId: {exact: deviceId}} : {})};
  }

  protected async connectMedia(credentials: {url: string; token: string}, peerId: string): Promise<void> {
    const generation = this.mediaGeneration;
    const sdk = await import('livekit-client');
    if (generation !== this.mediaGeneration) return;
    this.sdk = sdk;
    const room = new sdk.Room({adaptiveStream: false, dynacast: true, disconnectOnPageLeave: false, stopLocalTrackOnUnpublish: false});
    this.room = room;
    const current = () => this.room === room && generation === this.mediaGeneration;
    room.on(sdk.RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (current() && participant.identity === peerId) this.attachTrack(track, publication.source);
    });
    room.on(sdk.RoomEvent.TrackUnsubscribed, (track, publication) => {
      if (!current()) return;
      if (publication.source === sdk.Track.Source.Camera && this.remoteCameraStream()?.getTracks().includes(track.mediaStreamTrack)) this.remoteCameraStream.set(null);
      if (publication.source === sdk.Track.Source.ScreenShare && this.remoteScreenStream()?.getTracks().includes(track.mediaStreamTrack)) this.remoteScreenStream.set(null);
      if (track.kind === sdk.Track.Kind.Audio && (this.remoteAudioElement?.srcObject as MediaStream | null)?.getTracks().includes(track.mediaStreamTrack)) this.clearRemoteAudio();
    });
    const reconnecting = () => {if(current()){this.state.set('connecting');this.notice.set('Восстанавливаем соединение…');}};
    room.on(sdk.RoomEvent.Reconnecting, reconnecting);
    room.on(sdk.RoomEvent.SignalReconnecting, reconnecting);
    room.on(sdk.RoomEvent.Reconnected, () => {if(current()){this.state.set('connected');this.notice.set(null);void this.playAudio();}});
    room.on(sdk.RoomEvent.Disconnected, () => {if(current())this.mediaFailed('Соединение со звонком потеряно');});
    room.on(sdk.RoomEvent.ParticipantDisconnected, () => {if(current()){this.remoteCameraStream.set(null);this.remoteScreenStream.set(null);this.clearRemoteAudio();}});
    window.addEventListener('pointerdown', this.unlockAudio);
    window.addEventListener('keydown', this.unlockAudio);
    let stream: MediaStream | null = null;
    try {
      window.kvaAndroid?.directAudio?.(true);
      stream = await navigator.mediaDevices.getUserMedia({audio: this.microphoneConstraints(this.inputDeviceId())});
      if (!current()) {stream.getTracks().forEach(t => t.stop());return;}
      this.localStream = stream;
      const microphone = stream.getAudioTracks()[0];
      if (!microphone) throw Error('Микрофон недоступен');
      microphone.enabled = !this.localMuted();
      this.localAudioTrack = new sdk.LocalAudioTrack(microphone, undefined, true);
      await room.connect(credentials.url || SFU_BASE_URL, credentials.token, {rtcConfig: {iceServers: VOICE_ICE_SERVERS}});
      if (!current()) {await room.disconnect();return;}
      await room.localParticipant.publishTrack(this.localAudioTrack, {source: sdk.Track.Source.Microphone});
      if (!current()) return;
      this.setLocalMuted(this.localMuted());
      this.state.set('connected');
      this.notice.set(null);
      await this.playAudio();
    } catch (error) {
      if (!current()) {stream?.getTracks().forEach(t => t.stop());return;}
      throw error;
    }
  }

  private attachTrack(track: RemoteTrack, source: Track.Source): void {
    const stream = new MediaStream([track.mediaStreamTrack]);
    if (source === this.sdk!.Track.Source.Camera) this.remoteCameraStream.set(stream);
    else if (source === this.sdk!.Track.Source.ScreenShare) this.remoteScreenStream.set(stream);
    else if (track.kind === this.sdk!.Track.Kind.Audio) {
      this.clearRemoteAudio();
      const audio = new Audio();
      prepareInlineMediaElement(audio);
      audio.srcObject = stream;
      this.remoteAudioElement = audio;
      this.applyRemoteVolume();
      void this.updateOutputDevice(this.outputDeviceId()).then(() => this.playAudio());
    }
  }

  private async playAudio(): Promise<void> {
    try {
      await this.room?.startAudio();
      await this.remoteAudioElement?.play();
      if (this.notice() === 'Коснитесь экрана, чтобы включить звук') this.notice.set(null);
    } catch {if(this.room)this.notice.set('Коснитесь экрана, чтобы включить звук');}
  }

  async updateInputDevice(deviceId: string | null): Promise<void> {
    if (this.deviceChanging() || !this.localStream || !this.localAudioTrack) return;
    const previous = this.localStream, published = this.localAudioTrack;
    this.deviceChanging.set(true);this.deviceNotice.set(null);
    let replacement: MediaStream | null = null;
    try {
      replacement = await navigator.mediaDevices.getUserMedia({audio: this.microphoneConstraints(deviceId)});
      if (this.localStream !== previous || this.localAudioTrack !== published) return;
      const track = replacement.getAudioTracks()[0];
      if (!track) throw Error('No microphone');
      track.enabled = !this.localMuted();
      await published.replaceTrack(track, true);
      if (this.localStream !== previous || this.localAudioTrack !== published) return;
      this.localStream = replacement;replacement = null;
      previous.getTracks().forEach(t => t.stop());
      this.inputDeviceId.set(deviceId);
      this.setLocalMuted(this.localMuted());
    } catch {if(this.localStream === previous)this.deviceNotice.set('Не удалось переключить микрофон. Прежний микрофон сохранён.');}
    finally {replacement?.getTracks().forEach(t => t.stop());this.deviceChanging.set(false);}
  }

  async updateOutputDevice(deviceId: string | null): Promise<void> {
    const audio = this.remoteAudioElement as (HTMLAudioElement & {setSinkId?: (id: string) => Promise<void>}) | null;
    if (!audio?.setSinkId) {if(deviceId)this.deviceNotice.set('Устройство вывода выбирается в настройках системы.');return;}
    try {await audio.setSinkId(deviceId ?? '');if(audio === this.remoteAudioElement)this.outputDeviceId.set(deviceId);}
    catch {if(audio === this.remoteAudioElement)this.deviceNotice.set('Не удалось переключить устройство вывода.');}
  }
  setLocalMuted(muted: boolean): void {
    this.localMuted.set(muted);
    this.localStream?.getAudioTracks().forEach(t => t.enabled = !muted);
    if (this.localAudioTrack) void (muted ? this.localAudioTrack.mute() : this.localAudioTrack.unmute()).catch(() => {});
  }
  toggleLocalMute(): void {this.setLocalMuted(!this.localMuted());}
  toggleOutputMuted(): void {this.outputMuted.update(value => !value);this.applyRemoteVolume();}
  updateRemoteVolume(value: number | string): void {
    if (!Number.isFinite(Number(value))) return;
    this.remoteVolume.set(Math.max(0, Math.min(100, Number(value))));this.applyRemoteVolume();
  }
  private applyRemoteVolume(): void {
    if(this.remoteAudioElement){this.remoteAudioElement.volume=this.outputMuted()?0:this.remoteVolume()/100;this.remoteAudioElement.muted=this.outputMuted();}
  }
  async setCameraDevice(deviceId: string | null): Promise<void> {
    const enabled=this.isCameraEnabled();if(enabled)await this.stopCamera();
    this.cameraDeviceId.set(deviceId);if(enabled)await this.startCamera();
  }
  async startCamera(): Promise<void> {await this.startVideo(false);}
  async startScreenShare(): Promise<void> {await this.startVideo(true);}
  private async startVideo(screen: boolean): Promise<void> {
    const room=this.room,sdk=this.sdk;
    if(!room || !sdk || room.state !== 'connected' || (screen ? this.screenBusy || this.screenTrack : this.cameraBusy || this.cameraTrack))return;
    if(screen)this.screenBusy=true;else this.cameraBusy=true;
    let stream: MediaStream | null=null;
    let published: LocalVideoTrack | null=null;
    try {
      stream=screen ? await navigator.mediaDevices.getDisplayMedia({video:true,audio:false}) : await requestCameraStream(this.cameraDeviceId() ? {deviceId:{exact:this.cameraDeviceId()!}} : {facingMode:'user'});
      if(this.room!==room)return;
      const track=stream.getVideoTracks()[0];if(!track)throw Error('No video');
      published=new sdk.LocalVideoTrack(track,undefined,true);
      await room.localParticipant.publishTrack(published,{source:screen?sdk.Track.Source.ScreenShare:sdk.Track.Source.Camera,simulcast:!screen});
      if(this.room!==room){await room.localParticipant.unpublishTrack(published).catch(()=>{});return;}
      track.onended=()=>{void (screen?this.stopScreenShare():this.stopCamera());};
      if(screen){this.screenTrack=published;this.localScreenStream.set(stream);}else{this.cameraTrack=published;this.localCameraStream.set(stream);}
      stream=null;
    } catch {if(this.room===room)this.deviceNotice.set(screen?'Не удалось включить демонстрацию':'Не удалось включить камеру');}
    finally {stream?.getTracks().forEach(t=>t.stop());if(screen)this.screenBusy=false;else this.cameraBusy=false;}
  }
  async stopCamera(): Promise<void> {await this.stopVideo(false);}
  async stopScreenShare(): Promise<void> {await this.stopVideo(true);}
  private async stopVideo(screen: boolean): Promise<void> {
    const track=screen?this.screenTrack:this.cameraTrack,stream=screen?this.localScreenStream():this.localCameraStream(),room=this.room;
    if(screen){this.screenTrack=null;this.localScreenStream.set(null);}else{this.cameraTrack=null;this.localCameraStream.set(null);}
    stream?.getTracks().forEach(t=>{t.onended=null;t.stop();});
    if(track && room)await room.localParticipant.unpublishTrack(track,false).catch(()=>{});
  }
  private clearRemoteAudio(): void {
    if(this.remoteAudioElement){this.remoteAudioElement.pause();this.remoteAudioElement.srcObject=null;this.remoteAudioElement=null;}
  }
  protected disconnectMedia(): void {
    this.mediaGeneration++;
    const room=this.room;this.room=null;
    room?.removeAllListeners();
    void this.stopCamera();void this.stopScreenShare();
    this.localStream?.getTracks().forEach(t=>t.stop());this.localStream=null;
    this.localAudioTrack?.stop();this.localAudioTrack=null;
    window.kvaAndroid?.directAudio?.(false);
    if(room)void room.disconnect().catch(()=>{});
    this.clearRemoteAudio();this.remoteCameraStream.set(null);this.remoteScreenStream.set(null);
    this.localMuted.set(false);this.deviceNotice.set(null);this.deviceChanging.set(false);
    window.removeEventListener('pointerdown',this.unlockAudio);window.removeEventListener('keydown',this.unlockAudio);
  }
}
