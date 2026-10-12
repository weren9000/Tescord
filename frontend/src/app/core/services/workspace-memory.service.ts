import { Injectable } from '@angular/core';

interface ChannelMemory { draft?: string; anchor?: string; offset?: number; }
interface WorkspaceMemory { channels: Record<string, ChannelMemory>; spaces?: Record<string, string>; last?: { spaceId: string; channelId: string }; }

@Injectable({providedIn:'root'})
export class WorkspaceMemoryService {
  private user = ''; private value: WorkspaceMemory = {channels:{}};
  useUser(id: string){
    if(this.user===id)return;
    this.user=id;this.value={channels:{}};
    try{const saved=JSON.parse(localStorage.getItem('kva-workspace:'+id) ?? 'null');if(saved?.channels && typeof saved.channels==='object')this.value=saved;}catch{/* Unavailable storage must not prevent chatting. */}
  }
  channel(id: string): ChannelMemory {
    const entry = this.value.channels[id];
    if (!entry || typeof entry !== 'object') return {};
    return {
      draft: typeof entry.draft === 'string' ? entry.draft : undefined,
      anchor: typeof entry.anchor === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(entry.anchor) ? entry.anchor : undefined,
      offset: typeof entry.offset === 'number' && Number.isFinite(entry.offset) ? entry.offset : 0,
    };
  }
  remember(id: string, update: ChannelMemory){
    if(!id||!this.user)return;
    const memory = {...this.channel(id), ...update};
    delete this.value.channels[id];
    this.value.channels[id] = memory;
    const keys=Object.keys(this.value.channels);for(const key of keys.slice(0,Math.max(0,keys.length-100)))delete this.value.channels[key];
    this.save();
  }
  visit(spaceId:string,channelId:string){this.value.last={spaceId,channelId};this.value.spaces={...this.value.spaces,[spaceId]:channelId};this.save();}
  lastChannel(spaceId:string){const id=this.value.spaces?.[spaceId];return typeof id==='string' ? id : undefined;}
  last(){const last=this.value.last;return typeof last?.spaceId==='string' && typeof last?.channelId==='string' ? last : undefined;}
  private save(){try{if(this.user)localStorage.setItem('kva-workspace:'+this.user,JSON.stringify(this.value));}catch{/* Memory remains usable when storage is full. */}}
}
