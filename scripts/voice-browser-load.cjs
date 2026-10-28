// 30 simultaneous publishers/subscribers using the same LiveKit JS SDK as the app.
// Only disposable loopback LiveKit and temporary test tokens are accepted.
const {chromium}=require('../desktop/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const plan=JSON.parse(fs.readFileSync(process.env.VOICE_TEST_CONFIG,'utf8'));
 assert.equal(plan.url,'ws://127.0.0.1:27880');
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage();
  await page.addScriptTag({path:path.resolve(__dirname,'../frontend/node_modules/livekit-client/dist/livekit-client.umd.js')});
  page.on('console',m=>{if(m.text().startsWith('LOAD '))console.log(m.text());});
  const result=await page.evaluate(async plan=>{
   const {Room,Track}=window.LivekitClient;
   const rooms=[],oscillators=[],audio=new AudioContext();
   await audio.resume();
   try {
    for(let i=0;i<30;i++){
     const room=new Room({adaptiveStream:false,dynacast:false});rooms.push(room);
     await room.connect(plan.url,plan.tokens[i]);
     const source=audio.createOscillator(),dest=audio.createMediaStreamDestination();
     source.frequency.value=200+i*15;source.connect(dest);source.start();oscillators.push(source);
     await room.localParticipant.publishTrack(dest.stream.getAudioTracks()[0],{source:Track.Source.Microphone});
     console.log('LOAD publisher '+(i+1));
    }
    let pairs=0,minimumPackets=0;
    const deadline=Date.now()+45000;
    while(Date.now()<deadline){
     pairs=0;minimumPackets=Infinity;
     for(const room of rooms)for(const participant of room.remoteParticipants.values())for(const publication of participant.audioTrackPublications.values()){
      if(!publication.track)continue;
      const stats=await publication.track.getRTCStatsReport();
      let packets=0;stats?.forEach(s=>{if(s.type==='inbound-rtp'&&(s.kind==='audio'||s.mediaType==='audio'))packets+=s.packetsReceived||0;});
      if(packets>=100){pairs++;minimumPackets=Math.min(minimumPackets,packets);}
     }
     if(pairs===870)break;
     await new Promise(resolve=>setTimeout(resolve,1000));
    }
    if(pairs!==870)throw Error('Expected 870 receiving audio pairs, got '+pairs);
    const extra=new Room();rooms.push(extra);let rejected=false;
    try{await extra.connect(plan.url,plan.tokens[30]);}catch{rejected=true;}
    if(!rejected)throw Error('31st participant was admitted');
    await rooms[0].disconnect();
    await new Promise(resolve=>setTimeout(resolve,1000));
    await extra.connect(plan.url,plan.tokens[31]);
    return {publishers:30,full_subscribers:30,received_audio_pairs:pairs,minimum_packets:minimumPackets,rejected_31st:rejected,released_seat_reused:true};
   }finally{for(const source of oscillators)source.stop();await Promise.allSettled(rooms.map(r=>r.disconnect()));await audio.close();}
  },plan);
  fs.writeFileSync(process.env.VOICE_TEST_RESULT,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
