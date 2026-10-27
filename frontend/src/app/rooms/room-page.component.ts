import { Component, Directive, ElementRef, Input, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Room, RoomEvent, Track, RemoteTrack, TrackPublication } from 'livekit-client';
import { API_BASE_URL, VOICE_ICE_SERVERS } from '../core/api/api-base';
import { SessionStorageService } from '../core/services/session-storage.service';
import { ThemeControllerComponent } from '../workspace/theme-controller.component';
import { AndroidCallOutputComponent } from '../workspace/android-call-output.component';
import { TextFileViewerComponent, TextFileSource } from '../workspace/text-file-viewer.component';
import { isTextFile } from '../shared/text-files';
import { ParticipantAudioOutput } from '../shared/participant-audio-output';
import { UiIconComponent } from '../workspace/ui-icon.component';

interface Ticket { token: string; participant_id: string; session_id: string; is_owner: boolean; invite?: string | null; }
interface Person { id: string; name: string; is_owner: boolean; silenced: boolean; }
interface MeetingState { name: string; locked: boolean; chat_revision: number; owner_deadline: string | null; server_time: string; remaining_uses: number | null; participants: Person[]; }
interface Attachment { id: string; filename: string; size?: number; mime_type?: string; }
interface Message { id: string; author_id: string; author: string; content: string; created_at: string; edited_at: string | null; reply_to_id: string | null; uploads: Attachment[]; reactions: {emoji: string; participant_id: string}[]; }
interface Video { id: string; participant: string; name: string; track: Track; screen: boolean; }

@Directive({selector: 'video[meetingTrack]', standalone: true})
export class MeetingTrackDirective implements OnDestroy {
  private readonly element = inject(ElementRef<HTMLVideoElement>);
  private track: Track | null = null;
  @Input() set meetingTrack(track: Track) {
    if (this.track === track) return;
    this.track?.detach(this.element.nativeElement);
    this.track = track; track.attach(this.element.nativeElement);
  }
  ngOnDestroy() { this.track?.detach(this.element.nativeElement); }
}

@Component({
  selector: 'app-root', standalone: true,
  imports: [CommonModule, FormsModule, MeetingTrackDirective, ThemeControllerComponent, AndroidCallOutputComponent, TextFileViewerComponent, UiIconComponent],
  templateUrl: './room-page.component.html', styleUrl: './room-page.component.scss',
})
export class RoomPageComponent implements OnInit, OnDestroy {
  @ViewChild('messageList') messageList?: ElementRef<HTMLElement>;
  private readonly http = inject(HttpClient);
  readonly account = inject(SessionStorageService).read();
  readonly personal = location.pathname.replace(/\/$/, '') === '/my-room';
  readonly android = !!window.kvaAndroid;
  readonly canShareScreen = !!navigator.mediaDevices?.getDisplayMedia;
  readonly inviteCode = this.personal ? '' : location.pathname.split('/')[2] || '';
  readonly error = signal(''); readonly notice = signal(''); readonly busy = signal(false);
  readonly ticket = signal<Ticket | null>(null); readonly state = signal<MeetingState | null>(null);
  readonly messages = signal<Message[]>([]); readonly videos = signal<Video[]>([]);
  readonly olderMessages = signal<Message[]>([]); readonly hasOlder = signal(false);
  readonly speakers = signal<string[]>([]); readonly connected = signal(false);
  readonly microphone = signal(false); readonly camera = signal(false); readonly screen = signal(false);
  readonly audioBlocked = signal(false); readonly devices = signal<MediaDeviceInfo[]>([]);
  readonly textPreview = signal<TextFileSource | null>(null); readonly isTextFile = isTextFile;
  readonly invite = signal(''); readonly ended = signal(false); readonly inviteReady = signal(false);
  readonly preview = signal<{url: string; filename: string} | null>(null);
  readonly panel = signal<'chat' | 'participants' | null>(null);
  readonly unread = signal(0);
  readonly copied = signal(false);
  readonly microphoneStates = signal<Record<string, boolean>>({});
  readonly selectedScreen = signal<string | null>(null);
  readonly viewportHeight = signal(window.visualViewport?.height || window.innerHeight);
  private readonly resizeViewport = () => this.viewportHeight.set(window.visualViewport?.height || window.innerHeight);
  private messagesLoaded = false;
  private copyTimer?: ReturnType<typeof setTimeout>;
  name = this.account?.user.nick || ''; hours = 24; uses = 49; text = ''; reply: Message | null = null;
  editing: Message | null = null; uploads: Attachment[] = []; page = 0;
  private readonly restoreVolume: Partial<Record<string, number>> = {};
  readonly personalVolume: Partial<Record<string, number>> = {};
  readonly emojis = ['👍', '❤️', '😂', '🎉', '👀', '😢'];
  private room: Room | null = null;
  private outputDeviceId = 'default';
  private timer?: ReturnType<typeof setInterval>; private polling = false; private tick = 0;
  private readonly audio = new Map<string, {element: HTMLAudioElement; participant: string; track: RemoteTrack; playback: ParticipantAudioOutput}>();
  private readonly storageKey = 'kva.meeting.' + (this.personal ? 'owner' : this.inviteCode);
  private disposed = false;
  private readonly unload = () => {
    const ticket = this.ticket();
    if (ticket) void fetch(API_BASE_URL + '/api/rooms/leave', {method: 'POST', headers: {Authorization: 'Bearer '+ticket.token}, keepalive: true}).catch(()=>{});
  };

  async ngOnInit() {
    window.visualViewport?.addEventListener('resize', this.resizeViewport);
    window.addEventListener('resize', this.resizeViewport);
    window.addEventListener('pagehide', this.unload);
    try {
      const saved = sessionStorage.getItem(this.storageKey);
      this.invite.set(this.personal ? sessionStorage.getItem(this.storageKey+'.invite') || '' : this.inviteUrl(this.inviteCode));
      if (saved) {
        this.ticket.set(JSON.parse(saved) as Ticket);
        try { await this.enter(); return; }
        catch { this.clearSession(); }
      }
      if (this.personal && this.account) {
        const info = await this.request<{active: boolean; cleanup_pending: boolean}>('GET', '/mine', undefined, this.account.access_token);
        this.notice.set(info.cleanup_pending ? 'Предыдущая встреча завершается. Попробуйте через несколько секунд.' : '');
      } else if (!this.personal) {
        const info = await this.request<{locked: boolean; remaining_uses: number}>('GET', '/invite/'+this.inviteCode);
        this.inviteReady.set(!info.locked && info.remaining_uses > 0);
        if (info.locked) this.notice.set('Владелец закрыл вход во встречу.');
        else if (info.remaining_uses <= 0) this.notice.set('Лимит входов по ссылке исчерпан.');
      }
    } catch (error) { this.showError(error); }
  }

  private request<T>(method: string, path: string, body?: unknown, token = this.ticket()?.token) {
    return firstValueFrom(this.http.request<T>(method, API_BASE_URL+'/api/rooms'+path,
      {body, headers: token ? {Authorization: 'Bearer '+token} : {}}));
  }
  private save() { try { sessionStorage.setItem(this.storageKey, JSON.stringify(this.ticket())); } catch {} }
  private clearSession() { this.ticket.set(null);this.messages.set([]);this.olderMessages.set([]);this.uploads=[];this.text='';this.reply=null;this.editing=null;this.panel.set(null);this.unread.set(0);this.messagesLoaded=false;this.page=0; try { sessionStorage.removeItem(this.storageKey); } catch {} }
  private showError(error: unknown) {
    const detail = error instanceof HttpErrorResponse ? error.error?.detail : null;
    this.error.set(typeof detail === 'string' ? detail : error instanceof Error ? error.message : 'Не удалось выполнить действие. Попробуйте ещё раз.');
  }
  async run(action: () => Promise<unknown>) {
    if (this.busy()) return;
    this.busy.set(true); this.error.set('');
    try { await action(); } catch(error) { this.showError(error); } finally { this.busy.set(false); }
  }
  async join() {
    await this.run(async () => {
      let t: Ticket;
      if (this.personal) {
        if (!this.account) return;
        t = await this.request<Ticket>('POST', '/start', {hours: this.hours, uses: this.uses}, this.account.access_token);
      } else {
        let nonce = sessionStorage.getItem(this.storageKey+'.nonce');
        if (!nonce) { nonce = crypto.randomUUID().replace(/-/g,'')+crypto.randomUUID().replace(/-/g,''); sessionStorage.setItem(this.storageKey+'.nonce', nonce); }
        t = await this.request<Ticket>('POST', '/invite/'+this.inviteCode+'/join', {name: this.name, nonce});
      }
      this.ticket.set(t); this.save(); this.ended.set(false);
      if (t.invite) this.invite.set(this.inviteUrl(t.invite));
      this.saveInvite();
      await this.enter();
    });
  }
  private async enter() {
    this.ticket.set(await this.request<Ticket>('POST', '/heartbeat')); this.save();
    await this.refresh();
    this.timer = setInterval(()=>void this.poll(), 3000);
    // The click grants audio playback; microphone/camera are only enabled explicitly.
    try { await this.connectMedia(); } catch(error) { this.showError(error); }
  }
  async refresh() {
    const state = await this.request<MeetingState>('GET','/state');
    const messages = state.chat_revision !== this.state()?.chat_revision
      ? await this.request<Message[]>('GET','/messages') : null;
    if (this.disposed || !this.ticket()) return;
    this.state.set(state);
    if(messages){
      const list=this.messageList?.nativeElement;
      const bottom=!list || list.scrollHeight-list.scrollTop-list.clientHeight<80;
      // Refresh the history pages the user has opened as well, so edits,
      // deletions and reactions on older messages do not leave stale content.
      if(this.olderMessages().length && messages.length){
        const wanted=this.olderMessages().length;let history:Message[]=[];let cursor=messages[0].id;
        while(history.length<wanted){
          const page=await this.request<Message[]>('GET','/messages?before='+cursor);
          history=[...page,...history];if(page.length<200)break;cursor=page[0].id;
        }
        if(this.disposed || !this.ticket())return;
        this.olderMessages.set(history);
      }
      if(this.messagesLoaded && this.panel()!=='chat') {
        const known=new Set(this.messages().map(m=>m.id));
        this.unread.update(n=>n+messages.filter(m=>!known.has(m.id) && m.author_id!==this.ticket()?.participant_id).length);
      }
      this.messagesLoaded=true;
      this.messages.set(messages);if(!this.olderMessages().length)this.hasOlder.set(messages.length === 200);
      if(bottom)requestAnimationFrame(()=>{const el=this.messageList?.nativeElement;if(el)el.scrollTop=el.scrollHeight;});
    }
    if (state.participants.find(p=>p.id===this.ticket()?.participant_id)?.silenced) {
      this.microphone.set(false); this.camera.set(false); this.screen.set(false);
    }
  }
  private async poll() {
    if (this.polling || !this.ticket()) return;
    this.polling = true;
    try {
      if (++this.tick % 4 === 0) { this.ticket.set(await this.request<Ticket>('POST','/heartbeat')); this.save(); }
      await this.refresh();
    } catch(error) {
      if (error instanceof HttpErrorResponse && [401,403,410].includes(error.status)) {
        this.showError(error); await this.disconnect(); this.clearSession(); this.ended.set(true);
      } else { this.notice.set('Связь с сервером прервана. Пробуем восстановить…'); }
    } finally { this.polling = false; }
  }
  async connectMedia() {
    if (this.room) await this.disconnectMedia();
    const grant = await this.request<{url:string;token:string}>('POST','/media');
    if (this.disposed || !this.ticket()) return;
    const room = new Room({adaptiveStream: true, dynacast: true}); this.room = room;
    room.on(RoomEvent.TrackSubscribed, (track, _publication, p) => {
      if (track.kind === Track.Kind.Audio) {
        this.removeAudio(track.sid!);
        const element = new Audio();
        element.autoplay = true; element.style.display = 'none'; document.body.appendChild(element);
        const playback = new ParticipantAudioOutput(element);
        playback.setStream(new MediaStream([track.mediaStreamTrack]));
        this.audio.set(track.sid!, {element, participant:p.identity, track, playback}); this.updateVolumes();
        if(this.outputDeviceId!=='default' && 'setSinkId' in element) void element.setSinkId(this.outputDeviceId).catch(error=>this.showError(error));
        void playback.play().catch(()=>this.audioBlocked.set(true));
      }
      this.updateVideos();
    });
    room.on(RoomEvent.TrackUnsubscribed, track => { if(this.audio.get(track.sid!)?.track===track)this.removeAudio(track.sid!); this.updateVideos(); });
    room.on(RoomEvent.LocalTrackPublished, ()=>this.updateVideos());
    room.on(RoomEvent.LocalTrackUnpublished, ()=>this.updateVideos());
    room.on(RoomEvent.TrackMuted, ()=>this.updateVideos());
    room.on(RoomEvent.TrackUnmuted, ()=>this.updateVideos());
    room.on(RoomEvent.AudioPlaybackStatusChanged, ()=>this.audioBlocked.set(!room.canPlaybackAudio));
    room.on(RoomEvent.ParticipantDisconnected, ()=>this.updateVideos());
    room.on(RoomEvent.ActiveSpeakersChanged, people=>this.speakers.set(people.map(p=>p.identity)));
    room.on(RoomEvent.Disconnected, ()=>{this.connected.set(false); this.microphone.set(false);this.camera.set(false);this.screen.set(false);});
    room.on(RoomEvent.Reconnecting, ()=>this.notice.set('Восстанавливаем звук и видео…'));
    room.on(RoomEvent.Reconnected, ()=>{this.connected.set(true);this.notice.set('');});
    await room.connect(grant.url, grant.token, {rtcConfig: {iceServers: VOICE_ICE_SERVERS}});
    if (this.disposed || this.room !== room) { await room.disconnect(); return; }
    this.connected.set(true); this.notice.set(''); window.kvaAndroid?.directAudio?.(true); await room.startAudio();
  }
  private updateVideos() {
    const room = this.room; if (!room) return;
    this.microphone.set(room.localParticipant.isMicrophoneEnabled);
    this.camera.set(room.localParticipant.isCameraEnabled);
    this.screen.set(room.localParticipant.isScreenShareEnabled);
    const videos: Video[] = [];
    const microphones: Record<string, boolean> = {};
    for (const p of [room.localParticipant, ...room.remoteParticipants.values()]) {
      microphones[p.identity] = p.isMicrophoneEnabled;
      p.videoTrackPublications.forEach((pub: TrackPublication) => {
        if (pub.track && !pub.isMuted) videos.push({id: pub.trackSid, participant: p.identity, name:p.name || 'Гость', track: pub.track, screen:pub.source===Track.Source.ScreenShare});
      });
    }
    this.videos.set(videos.sort((a,b)=>Number(b.screen)-Number(a.screen)));
    this.microphoneStates.set(microphones);
  }
  visiblePeople() {const people=this.state()?.participants || [];const last=Math.max(0,Math.ceil(people.length/9)-1);return people.slice(Math.min(this.page,last)*9,(Math.min(this.page,last)+1)*9);}
  currentPage() {return Math.min(this.page,Math.max(0,Math.ceil((this.state()?.participants.length || 1)/9)-1));}
  cameraFor(id:string) {return this.videos().find(v=>v.participant===id && !v.screen);}
  screens() {return this.videos().filter(v=>v.screen);}
  presentation() {return this.screens().find(v=>v.id===this.selectedScreen()) || this.screens()[0];}
  initials(name:string) {return name.trim().split(/\s+/).slice(0,2).map(s=>Array.from(s)[0]).join('').toUpperCase();}
  personMuted(p:Person) {return p.silenced || !this.microphoneStates()[p.id];}
  togglePanel(panel:'chat'|'participants') {this.panel.set(this.panel()===panel?null:panel);if(this.panel()==='chat'){this.unread.set(0);requestAnimationFrame(()=>{const el=this.messageList?.nativeElement;if(el)el.scrollTop=el.scrollHeight;});}}
  openSettings(dialog:HTMLDialogElement) {dialog.showModal();void this.loadDevices();}
  exitMeeting(dialog:HTMLDialogElement) {if(this.ticket()?.is_owner)dialog.showModal();else void this.leave();}
  async finishMeeting(dialog:HTMLDialogElement,end=false) {await this.leave(end);if(!this.error())dialog.close();}
  private saveInvite() {try {sessionStorage.setItem(this.storageKey+'.invite',this.invite());}catch{}}
  async resumeAudio() {await this.room?.startAudio();await Promise.all([...this.audio.values()].map(a=>a.playback.play()));this.audioBlocked.set(false);}
  async loadDevices() {await this.run(async()=>this.devices.set(await navigator.mediaDevices.enumerateDevices()));}
  devicesOf(kind:MediaDeviceKind){return this.devices().filter(d=>d.kind===kind);}
  async chooseDevice(kind:MediaDeviceKind,id:string){await this.run(async()=>{
    if(kind==='audiooutput'){
      for(const {element} of this.audio.values()){
        if(!('setSinkId' in element))throw new Error('Этот браузер не поддерживает выбор динамиков');
        await element.setSinkId(id);
      }
      this.outputDeviceId=id;
    }else await this.room?.switchActiveDevice(kind,id);
  });}
  async toggle(kind: 'microphone'|'camera'|'screen') {
    await this.run(async()=>{
      if (!this.room || !this.connected()) return;
      if (kind === 'microphone') { await this.room.localParticipant.setMicrophoneEnabled(!this.microphone()); this.microphone.set(this.room.localParticipant.isMicrophoneEnabled); }
      if (kind === 'camera') { await this.room.localParticipant.setCameraEnabled(!this.camera()); this.camera.set(this.room.localParticipant.isCameraEnabled); }
      if (kind === 'screen') { await this.room.localParticipant.setScreenShareEnabled(!this.screen()); this.screen.set(this.room.localParticipant.isScreenShareEnabled); }
      this.updateVideos();
    });
  }
  updateVolumes() { for (const a of this.audio.values()) a.playback.setVolume((this.personalVolume[a.participant] ?? 100)/100); }
  togglePersonalMute(id:string){const value=this.personalVolume[id] ?? 100;if(value>0)this.restoreVolume[id]=value;this.personalVolume[id]=value===0?(this.restoreVolume[id] ?? 100):0;this.updateVolumes();}
  private removeAudio(id: string) { const a = this.audio.get(id); if(a) {a.playback.dispose();a.element.remove();this.audio.delete(id);} }
  private async disconnectMedia() {
    window.kvaAndroid?.directAudio?.(false);
    const room = this.room; this.room=null; if (room) {room.removeAllListeners();await room.disconnect();}
    for (const id of this.audio.keys()) this.removeAudio(id);
    this.videos.set([]);this.connected.set(false);this.microphone.set(false);this.camera.set(false);this.screen.set(false);
  }
  private async disconnect() { if(this.timer)clearInterval(this.timer);this.timer=undefined;await this.disconnectMedia();this.closePreview();this.textPreview.set(null); }
  async leave(end = false) {
    await this.run(async()=>{
      await this.request('POST', end ? '/control' : '/leave', end ? {action:'end'} : undefined);
      await this.disconnect();this.clearSession();this.ended.set(end);this.state.set(null);
      this.notice.set('');
    });
  }
  private inviteUrl(raw:string) {return (API_BASE_URL.startsWith('https://') ? API_BASE_URL : location.origin)+'/room/'+raw;}
  async rotate() { await this.run(async()=>{const r=await this.request<{invite:string}>('POST','/invite',{hours:this.hours,uses:this.uses});this.invite.set(this.inviteUrl(r.invite));this.saveInvite();this.copied.set(false);await this.refresh();}); }
  async copyInvite() { await this.run(async()=>{if(!this.invite())return;await navigator.clipboard.writeText(this.invite());this.copied.set(true);clearTimeout(this.copyTimer);this.copyTimer=setTimeout(()=>this.copied.set(false),2500);}); }
  async control(action:string, participant_id?:string) { await this.run(async()=>{await this.request('POST','/control',{action,participant_id});await this.refresh();}); }
  async send() {
    await this.run(async()=>{
      await this.request(this.editing?'PATCH':'POST', '/messages'+(this.editing?'/'+this.editing.id:''), {content:this.text, reply_to_id:this.reply?.id,uploads:this.uploads.map(u=>u.id)});
      this.text='';this.reply=null;this.editing=null;this.uploads=[];await this.refresh();
    });
  }
  edit(m:Message) {this.editing=m;this.text=m.content;this.reply=null;}
  async deleteMessage(m:Message) {await this.run(async()=>{await this.request('DELETE','/messages/'+m.id);this.olderMessages.update(items=>items.filter(x=>x.id!==m.id));await this.refresh();});}
  async loadOlder() {await this.run(async()=>{const first=this.olderMessages()[0] || this.messages()[0];if(!first)return;const items=await this.request<Message[]>('GET','/messages?before='+first.id);this.olderMessages.set([...items,...this.olderMessages()]);this.hasOlder.set(items.length===200);});}
  allMessages() {const current=new Set(this.messages().map(m=>m.id));return [...this.olderMessages().filter(m=>!current.has(m.id)),...this.messages()];}
  replyText(id:string){const m=this.allMessages().find(m=>m.id===id);return m?m.author+': '+(m.content || 'Вложение').slice(0,160):'Ответ на более раннее сообщение';}
  openText(u:Attachment){this.textPreview.set({name:u.filename,size:u.size || 0,load:()=>firstValueFrom(this.http.get(API_BASE_URL+'/api/rooms/uploads/'+u.id+'?text_preview=true',{headers:{Authorization:'Bearer '+this.ticket()!.token},responseType:'blob'})),download:()=>void this.openFile(u)});}
  async react(m:Message,emoji:string) {await this.run(async()=>{await this.request('POST','/messages/'+m.id+'/reaction',{emoji});await this.refresh();});}
  reactionCount(m:Message,emoji:string) {return m.reactions.filter(r=>r.emoji===emoji).length;}
  async pickFiles(event:Event) {
    const input=event.target as HTMLInputElement;const files=Array.from(input.files || []);input.value='';
    await this.run(async()=>{
      if(files.length+this.uploads.length>10)throw new Error('Не больше 10 вложений в сообщении');
      for(const file of files){const form=new FormData();form.append('file',file);this.uploads.push(await this.request<Attachment>('POST','/uploads',form));}
    });
  }
  async discard(u:Attachment) {await this.run(async()=>{await this.request('DELETE','/uploads/'+u.id);this.uploads=this.uploads.filter(x=>x.id!==u.id);});}
  async openFile(u:Attachment, preview=false) {
    await this.run(async()=>{
      const blob=await firstValueFrom(this.http.get(API_BASE_URL+'/api/rooms/uploads/'+u.id+(preview?'?preview=true':''),{headers:{Authorization:'Bearer '+this.ticket()!.token},responseType:'blob'}));
      const url=URL.createObjectURL(blob);
      if(preview){this.closePreview();this.preview.set({url,filename:u.filename});}
      else{const a=document.createElement('a');a.href=url;a.download=u.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
    });
  }
  closePreview(){const current=this.preview();if(current)URL.revokeObjectURL(current.url);this.preview.set(null);}
  countdown(){const s=this.state();if(!s?.owner_deadline)return '';const seconds=Math.max(0,Math.ceil((Date.parse(s.owner_deadline)-Date.parse(s.server_time))/1000));return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');}
  ngOnDestroy(){this.disposed=true;clearTimeout(this.copyTimer);window.visualViewport?.removeEventListener('resize',this.resizeViewport);window.removeEventListener('resize',this.resizeViewport);window.removeEventListener('pagehide',this.unload);this.unload();void this.disconnect();}
}
