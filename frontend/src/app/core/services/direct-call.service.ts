import {Injectable, computed, signal} from '@angular/core';
import {API_BASE_URL, WS_BASE_URL} from '../api/api-base';
import {authenticatedWebSocket} from './authenticated-websocket';
import {CallRingtone} from './call-ringtone';
import {DirectCallMedia} from './direct-call-media';

export interface DirectCallPeer {user_id: string; nick: string; avatar_updated_at: string | null;}
interface CallMessage {
  type: string;
  user_id?: string;
  call_id?: string | null;
  peer?: DirectCallPeer;
  detail?: string;
  transport?: string;
}

@Injectable({providedIn:'root'})
export class DirectCallService extends DirectCallMedia {
  private socket: WebSocket | null=null;
  private currentToken: string | null=null;
  private currentUserId: string | null=null;
  private activeCallId: string | null=null;
  private readonly clientId=crypto.randomUUID();
  private readonly ringtone=new CallRingtone();
  private reconnectTimer: ReturnType<typeof setTimeout> | null=null;
  private pingTimer: ReturnType<typeof setInterval> | null=null;
  private reconnectDeadline: ReturnType<typeof setTimeout> | null=null;
  private requestTimer: ReturnType<typeof setTimeout> | null=null;
  private joinAbort: AbortController | null=null;
  private manuallyStopped=true;
  private reconnectAttempt=0;
  private joiningCall: string | null=null;
  private pendingHangup: string | null=null;
  readonly connected=signal(false);
  readonly peer=signal<DirectCallPeer | null>(null);
  readonly canCall=computed(()=>this.connected() && !this.hasActiveCall());

  start(token: string): void {
    if(!token.trim())return;
    if(this.currentToken===token && this.socket && this.socket.readyState<2)return;
    if(this.currentToken && this.currentToken!==token)this.stop();
    this.currentToken=token;this.manuallyStopped=false;this.ringtone.install();
    this.openSocket();
  }
  stop(): void {
    if(this.activeCallId)this.send({type:'hangup',call_id:this.activeCallId});
    this.manuallyStopped=true;this.currentToken=null;this.currentUserId=null;
    this.resetCallState();this.ringtone.dispose();
    if(this.reconnectTimer)clearTimeout(this.reconnectTimer);this.reconnectTimer=null;
    this.clearSocketTimers();
    const socket=this.socket;this.socket=null;socket?.close();this.connected.set(false);
  }
  openCall(peer: DirectCallPeer): void {
    if(!this.canCall()){this.error.set('Сначала завершите текущий звонок или дождитесь подключения');return;}
    if(peer.user_id===this.currentUserId)return;
    this.clearFeedback();this.peer.set(peer);this.state.set('outgoing');
    this.send({type:'call_request',target_user_id:peer.user_id,transport:'sfu'});
    this.requestTimer=setTimeout(()=>{if(!this.activeCallId){this.resetCallState();this.error.set('Не удалось отправить вызов');}},10000);
  }
  acceptIncoming(): void {
    if(this.state()!=='incoming' || !this.activeCallId || !this.connected())return;
    this.ringtone.stop();this.state.set('connecting');this.clearFeedback();
    this.send({type:'call_response',call_id:this.activeCallId,action:'accept',transport:'sfu'});
  }
  rejectIncoming(): void {
    if(this.state()!=='incoming' || !this.activeCallId)return;
    this.send({type:'call_response',call_id:this.activeCallId,action:'reject'});this.resetCallState();
  }
  async hangUp(): Promise<void> {
    const id=this.activeCallId;this.resetCallState();
    if(id && !this.send({type:'hangup',call_id:id}))this.pendingHangup=id;
  }
  clearFeedback(): void {this.error.set(null);this.notice.set(null);}
  protected mediaFailed(message: string): void {this.error.set(message);void this.hangUp();}

  private openSocket(): void {
    if(this.manuallyStopped || !this.currentToken)return;
    if(this.reconnectTimer)clearTimeout(this.reconnectTimer);this.reconnectTimer=null;
    const socket=authenticatedWebSocket(`${WS_BASE_URL}/api/calls/ws?client_id=${this.clientId}`,this.currentToken);
    this.socket=socket;this.connected.set(false);
    socket.addEventListener('message',event=>{
      if(this.socket!==socket || typeof event.data!=='string')return;
      try {void this.handleMessage(JSON.parse(event.data) as CallMessage);}catch {/* Ignore malformed control frames. */}
    });
    socket.addEventListener('close',event=>{
      if(this.socket!==socket)return;
      this.socket=null;this.connected.set(false);this.clearSocketTimers();
      if([4401,4403].includes(event.code)){this.stop();this.error.set('Сессия устарела. Войдите снова.');return;}
      if(this.hasActiveCall()){
        this.notice.set('Восстанавливаем соединение…');
        this.reconnectDeadline=setTimeout(()=>{if(!this.connected()){this.resetCallState();this.notice.set('Звонок прерван');}},20000);
      }
      if(!this.manuallyStopped)this.reconnectTimer=setTimeout(()=>this.openSocket(),Math.min(1000*2**this.reconnectAttempt++,8000));
    });
  }
  private async handleMessage(message: CallMessage): Promise<void> {
    if(message.type==='ready'){
      this.connected.set(true);this.currentUserId=message.user_id??null;this.reconnectAttempt=0;
      this.clearSocketTimers();this.pingTimer=setInterval(()=>this.send({type:'ping'}),25000);
      if(this.pendingHangup){this.send({type:'hangup',call_id:this.pendingHangup});this.pendingHangup=null;}
      if(this.activeCallId && message.call_id!==this.activeCallId)this.resetCallState();
      if(this.room?.state==='connected')this.notice.set(null);
      return;
    }
    if(message.type==='incoming_call' && message.call_id && message.peer){
      if(this.hasActiveCall() && this.activeCallId!==message.call_id){this.send({type:'call_response',call_id:message.call_id,action:'reject'});return;}
      this.activeCallId=message.call_id;this.peer.set(message.peer);this.state.set('incoming');
      this.ringtone.start('incoming');
      void window.kvaDesktop?.notify?.({id:message.call_id,title:'Входящий звонок',body:message.peer.nick,target:'call'});
      return;
    }
    if(message.type==='call_ringing' && message.call_id && message.peer){
      if(this.state()!=='outgoing'){this.send({type:'hangup',call_id:message.call_id});return;}
      if(this.requestTimer)clearTimeout(this.requestTimer);this.requestTimer=null;
      this.activeCallId=message.call_id;this.peer.set(message.peer);this.ringtone.start('outgoing');return;
    }
    if(message.type==='call_accepted' && message.call_id && message.peer){
      if(this.activeCallId!==message.call_id){this.send({type:'hangup',call_id:message.call_id});return;}
      if(this.joiningCall===message.call_id)return;
      this.ringtone.stop();window.kvaDesktop?.clearNotifications?.('call');
      if(message.transport!=='sfu'){this.mediaFailed('Обновите приложение для личных звонков');return;}
      this.joiningCall=message.call_id;this.state.set('connecting');this.peer.set(message.peer);
      const id=message.call_id,generation=this.mediaGeneration;
      const abort=new AbortController();this.joinAbort=abort;
      const timeout=setTimeout(()=>{if(this.activeCallId===id && this.state()!=='connected'){abort.abort();this.mediaFailed('Не удалось подключиться к звонку');}},35000);
      try {
        const response=await fetch(`${API_BASE_URL}/api/calls/${id}/sfu-token`,{
          method:'POST',headers:{Authorization:`Bearer ${this.currentToken}`,'Content-Type':'application/json'},
          body:JSON.stringify({client_id:this.clientId}),signal:abort.signal
        });
        if(!response.ok)throw Error('Не удалось получить доступ к звонку');
        const credentials=await response.json();
        if(this.activeCallId!==id || generation!==this.mediaGeneration)return;
        await this.connectMedia(credentials,message.peer.user_id);
      }catch(error){if(this.activeCallId===id && generation===this.mediaGeneration)this.mediaFailed(error instanceof Error?error.message:'Не удалось подключиться к звонку');}
      finally{clearTimeout(timeout);if(this.joinAbort===abort)this.joinAbort=null;}
      return;
    }
    if(message.type==='call_ended' || message.type==='call_rejected'){
      if(message.call_id && message.call_id!==this.activeCallId)return;
      this.resetCallState();this.notice.set(message.detail??'Звонок завершён');return;
    }
    if(message.type==='error'){
      this.error.set(message.detail??'Ошибка звонка');
      if(this.hasActiveCall())void this.hangUp();
    }
  }
  private resetCallState(): void {
    this.joinAbort?.abort();this.joinAbort=null;
    this.ringtone.stop();this.disconnectMedia();
    this.activeCallId=null;this.joiningCall=null;this.peer.set(null);this.state.set('idle');
    if(this.requestTimer)clearTimeout(this.requestTimer);this.requestTimer=null;
    window.kvaDesktop?.clearNotifications?.('call');
  }
  private send(payload: object): boolean {
    if(this.socket?.readyState!==WebSocket.OPEN)return false;
    this.socket.send(JSON.stringify(payload));return true;
  }
  private clearSocketTimers(): void {
    if(this.pingTimer)clearInterval(this.pingTimer);this.pingTimer=null;
    if(this.reconnectDeadline)clearTimeout(this.reconnectDeadline);this.reconnectDeadline=null;
  }
}
