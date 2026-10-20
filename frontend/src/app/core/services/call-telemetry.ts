import type {Room} from 'livekit-client';
import {API_BASE_URL} from '../api/api-base';

/** Passive RTC statistics only: never changes subscriptions, encoding or audio processing. */
export function observeCall(room: Room, token: () => string | null): () => void {
  const started = performance.now();
  let connect: number | null = null, reconnects = 0, recovering = false;
  let stopped = false, busy = false, offset = 0;
  let abort: AbortController | null = null;
  const previous = new Map<string, {received: number; lost: number}>();
  const connected = () => {connect = performance.now() - started;};
  const reconnecting = () => {if (!recovering) reconnects++; recovering = true;};
  const reconnected = () => {recovering = false;};
  room.on('connected', connected);
  room.on('reconnecting', reconnecting);
  room.on('signalReconnecting', reconnecting);
  room.on('reconnected', reconnected);
  const timer = setInterval(() => {void sample();}, 15000);

  async function sample() {
    const auth = token();
    if (busy || stopped || !auth || room.state !== 'connected') return;
    busy = true;
    try {
      const tracks = [room.localParticipant, ...room.remoteParticipants.values()]
        .flatMap(p => [...p.trackPublications.values()].flatMap(p => p.track ? [p.track] : []));
      const rtt: number[] = [], jitter: number[] = [];
      let received = 0, lost = 0;
      // Bound work in large conferences; rotate through tracks each interval.
      for (let n = 0; n < Math.min(16, tracks.length); n++) {
        const track = tracks[(offset + n) % tracks.length];
        const report = await track.getRTCStatsReport();
        if (stopped) return;
        report?.forEach(s => {
          const seconds = s.currentRoundTripTime ?? s.roundTripTime;
          if (typeof seconds === 'number' && Number.isFinite(seconds)) rtt.push(seconds * 1000);
          if (s.type !== 'inbound-rtp' || s.isRemote) return;
          if (typeof s.jitter === 'number' && Number.isFinite(s.jitter)) jitter.push(s.jitter * 1000);
          if (typeof s.packetsReceived !== 'number' || typeof s.packetsLost !== 'number') return;
          const key = track.sid + ':' + s.id, old = previous.get(key);
          if (old && s.packetsReceived >= old.received && s.packetsLost >= old.lost) {
            received += s.packetsReceived - old.received; lost += s.packetsLost - old.lost;
          }
          if (previous.size >= 256 && !previous.has(key)) previous.delete(previous.keys().next().value!);
          previous.set(key, {received: s.packetsReceived, lost: s.packetsLost});
        });
      }
      offset = tracks.length ? (offset + 16) % tracks.length : 0;
      const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
      const body = {rtt_ms: mean(rtt), jitter_ms: mean(jitter),
        loss_percent: received + lost ? 100 * lost / (received + lost) : null,
        connect_ms: connect, reconnects};
      if (stopped) return;
      abort = new AbortController();
      const timeout = setTimeout(() => abort?.abort(), 5000);
      try {
        const response = await fetch(API_BASE_URL + '/api/telemetry/calls', {
          method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + auth},
          body: JSON.stringify(body), signal: abort.signal,
        });
        if (response.ok) {connect = null; reconnects = Math.max(0,reconnects-body.reconnects);}
      } finally {clearTimeout(timeout); abort = null;}
    } catch {/* Metrics are best-effort and must not affect the call. */}
    finally {busy = false;}
  }
  return () => {
    stopped = true; clearInterval(timer); abort?.abort(); previous.clear();
    room.off('connected', connected); room.off('reconnecting', reconnecting);
    room.off('signalReconnecting', reconnecting); room.off('reconnected', reconnected);
  };
}
