package ru.kvachat.android;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;
import androidx.core.app.NotificationCompat;
import org.json.*;
import okhttp3.*;
import java.util.*;
import java.util.concurrent.TimeUnit;

public class BackgroundService extends Service {
    static volatile BackgroundService instance;
    static volatile boolean visible=false;
    static volatile String pendingCall=null;
    static final String ORIGIN="https://kvachat.ru";
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final OkHttpClient client=new OkHttpClient.Builder().pingInterval(25,TimeUnit.SECONDS).build();
    private WebSocket events,calls;
    private boolean eventsReady=false;
    private String token;
    private volatile int generation=0;
    private int mediaType=0;
    private boolean callActive=false;
    private boolean stopped=false,refreshing=false,refreshAgain=false;
    private final Map<String,Integer> unread=new HashMap<>();
    private final Set<String> seen=new LinkedHashSet<>();
    private boolean initialized=false;
    private PowerManager.WakeLock wakeLock;

    @Override public void onCreate(){super.onCreate();instance=this;channels();}
    private void channels(){
        NotificationManager manager=getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("connection","Фоновое соединение",NotificationManager.IMPORTANCE_LOW));
        manager.createNotificationChannel(new NotificationChannel("messages","Сообщения",NotificationManager.IMPORTANCE_DEFAULT));
        manager.createNotificationChannel(new NotificationChannel("calls","Входящие звонки",NotificationManager.IMPORTANCE_HIGH));
    }
    static PendingIntent open(Context context,String target){
        Intent intent=new Intent(context,MainActivity.class).putExtra("target",target).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context,target.hashCode(),intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    private Notification ongoing(){
        Intent stop=new Intent(this,BackgroundService.class).setAction("stop");
        return new NotificationCompat.Builder(this,"connection").setSmallIcon(R.drawable.ic_notification).setContentTitle("KVA Chat")
            .setContentText("Фоновое соединение включено").setOngoing(true).setContentIntent(open(this,""))
            .addAction(0,"Остановить",PendingIntent.getService(this,0,stop,PendingIntent.FLAG_IMMUTABLE)).build();
    }
    @Override public int onStartCommand(Intent intent,int flags,int id){
        if(intent!=null&&"stop".equals(intent.getAction())){stopSelf();return START_NOT_STICKY;}
        try {
            startForeground(1,ongoing(),mediaType|(Build.VERSION.SDK_INT>=34?ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE:0));
            String session=SessionStore.read(this);
            if(session==null){stopSelf();return START_NOT_STICKY;}
            String next=new JSONObject(session).getString("access_token");
            if(!next.equals(token)){disconnect();token=next;initialized=false;unread.clear();seen.clear();stopped=false;connect();}
        }catch(Exception error){stopSelf();return START_NOT_STICKY;}
        return START_STICKY;
    }
    void media(boolean audio,boolean camera){
        boolean active=audio||camera;
        callActive=active;
        try {
            int type=Build.VERSION.SDK_INT>=34?ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE:0;
            int requested=Build.VERSION.SDK_INT>=30?((audio?ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE:0)|(camera?ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA:0)):0;
            type|=requested;
            startForeground(1,ongoing(),type);
            mediaType=requested;
            if(active&&wakeLock==null){wakeLock=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"KVA:call");wakeLock.acquire(3*60*60*1000L);}
            if(!active&&wakeLock!=null){if(wakeLock.isHeld())wakeLock.release();wakeLock=null;}
        }catch(Exception error){MainActivity.emit("kva-native-error","Не удалось продолжить звонок в фоне");}
    }
    private final Runnable presence = new Runnable(){public void run(){
        if(stopped)return;
        if(eventsReady&&events!=null)events.send("{\"type\":\"activity\"}");
        handler.postDelayed(this,60000);
    }};
    private void connect(){if(stopped||token==null)return;events=socket("events");calls=socket("calls");handler.post(presence);}
    private WebSocket socket(String kind){
        if(kind.equals("events"))eventsReady=false;
        final int epoch=generation;
        final String credential=token;
        return client.newWebSocket(new Request.Builder().url("wss://kvachat.ru/api/"+kind+"/ws"+(kind.equals("events")?"?background=1":"")).build(),new WebSocketListener(){
            @Override public void onOpen(WebSocket socket,Response response){if(epoch!=generation){socket.cancel();return;}try{socket.send(new JSONObject().put("type","authenticate").put("token",credential).toString());}catch(Exception ignored){}}
            @Override public void onMessage(WebSocket socket,String raw){handler.post(()->{
                if(stopped||epoch!=generation)return;
                try{
                    JSONObject event=new JSONObject(raw);String type=event.optString("type");
                    if(kind.equals("events")&&type.equals("ready")){eventsReady=true;socket.send("{\"type\":\"activity\"}");}
                    if(kind.equals("events")&&(type.equals("ready")||type.equals("servers_changed")||type.equals("resync_required")))refresh();
                    if(type.equals("incoming_call")){
                        pendingCall=raw;show(event.getString("call_id"),"Входящий звонок",event.getJSONObject("peer").optString("nick"),"call");
                    }
                    if(type.equals("call_ended")||type.equals("call_rejected")||type.equals("call_accepted")){pendingCall=null;clear("call");}
                }catch(Exception ignored){}
            });}
            @Override public void onFailure(WebSocket socket,Throwable error,Response response){retry();}
            @Override public void onClosing(WebSocket socket,int code,String reason){socket.close(code,reason);}
            @Override public void onClosed(WebSocket socket,int code,String reason){if(code==4401||code==4403)handler.post(()->{if(epoch==generation)stopSelf();});else retry();}
            private void retry(){handler.postDelayed(()->{if(!stopped&&epoch==generation){if(kind.equals("events"))events=socket(kind);else calls=socket(kind);}},5000);}
        });
    }
    private void refresh(){
        if(refreshing){refreshAgain=true;return;}refreshing=true;
        final int epoch=generation;
        client.newCall(new Request.Builder().url(ORIGIN+"/api/conversations").header("Authorization","Bearer "+token).build()).enqueue(new Callback(){
            @Override public void onFailure(Call call,java.io.IOException error){handler.post(()->{if(epoch==generation){refreshing=false;if(!stopped)handler.postDelayed(()->{if(epoch==generation&&!stopped)refresh();},5000);}});}
            @Override public void onResponse(Call call,Response response){try(response){
                if(!response.isSuccessful()){handler.post(()->{if(epoch==generation){refreshing=false;if(response.code()==401)stopSelf();}});return;}
                JSONArray rows=new JSONArray(response.body().string());handler.post(()->{
                    if(stopped||epoch!=generation)return;
                    try{for(int i=0;i<rows.length();i++){
                        JSONObject row=rows.getJSONObject(i);String id=row.getString("id");int count=row.optInt("unread_count");
                        if(initialized&&count>unread.getOrDefault(id,0)&&row.optBoolean("push_enabled"))show(id+":"+System.nanoTime(),row.optString("title"),row.optString("subtitle","Новое сообщение"),id);
                        unread.put(id,count);
                    }initialized=true;}catch(Exception ignored){}
                    refreshing=false;if(refreshAgain){refreshAgain=false;refresh();}
                });
            }catch(Exception error){handler.post(()->{if(epoch==generation)refreshing=false;});}}
        });
    }
    synchronized boolean show(String id,String title,String body,String target){
        if(stopped||visible||seen.contains(id))return false;seen.add(id);if(seen.size()>1000)seen.remove(seen.iterator().next());
        String channel=target.equals("call")?"calls":"messages";
        Notification notification=new NotificationCompat.Builder(this,channel).setSmallIcon(R.drawable.ic_notification).setContentTitle(title)
            .setContentText(body).setAutoCancel(true).setContentIntent(open(this,target)).setCategory(target.equals("call")?NotificationCompat.CATEGORY_CALL:NotificationCompat.CATEGORY_MESSAGE).build();
        getSystemService(NotificationManager.class).notify(target.hashCode(),notification);return true;
    }
    void clear(String target){getSystemService(NotificationManager.class).cancel(target.hashCode());}
    private void disconnect(){stopped=true;generation++;refreshing=false;refreshAgain=false;pendingCall=null;if(events!=null)events.cancel();if(calls!=null)calls.cancel();handler.removeCallbacksAndMessages(null);}
    @Override public void onDestroy(){disconnect();if(wakeLock!=null&&wakeLock.isHeld())wakeLock.release();instance=null;pendingCall=null;getSystemService(NotificationManager.class).cancelAll();super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
}
