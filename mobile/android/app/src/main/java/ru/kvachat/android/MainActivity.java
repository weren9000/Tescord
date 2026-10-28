package ru.kvachat.android;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import android.app.*;
import android.content.*;
import android.os.*;
import android.webkit.*;
import android.net.Uri;
import android.media.projection.MediaProjectionManager;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import java.lang.ref.WeakReference;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static WeakReference<MainActivity> current=new WeakReference<>(null);
    private volatile String target="";
    private DirectAudio directAudio;
    private String appLink(Uri uri) {
        if (uri == null || !"https".equals(uri.getScheme()) || !"kvachat.ru".equals(uri.getHost())
            || (uri.getPort() != -1 && uri.getPort() != 443)) return null;
        String path = uri.getPath();
        if (path == null || !path.matches("/|/login/?|/my-room/?|/room/[A-Za-z0-9_-]+/?|/invite/[A-Za-z0-9_-]+/?|/channels/[a-fA-F0-9-]+/[a-fA-F0-9-]+/?")) return null;
        return uri.getEncodedPath() + (uri.getEncodedQuery() == null ? "" : "?" + uri.getEncodedQuery());
    }
    private String intentTarget(Intent intent) {
        String link = appLink(intent.getData());
        return link != null ? link : intent.getStringExtra("target");
    }
    @Override protected void load(){
        directAudio = new DirectAudio(this);
        WebView view=findViewById(com.getcapacitor.android.R.id.webview);
        view.addJavascriptInterface(new NativeBridge(),"KvaNative");
        super.load();
    }
    private void offerBackgroundPermission(){
        if(!BackgroundService.visible||getPreferences(MODE_PRIVATE).getBoolean("batteryExplained",false))return;
        getPreferences(MODE_PRIVATE).edit().putBoolean("batteryExplained",true).apply();
        if(((PowerManager)getSystemService(POWER_SERVICE)).isIgnoringBatteryOptimizations(getPackageName()))return;
        new AlertDialog.Builder(this).setTitle("Уведомления в фоне")
            .setMessage("Разрешите KVA Chat работать без ограничения батареи, чтобы получать сообщения и звонки при заблокированном экране.")
            .setNegativeButton("Позже",null).setPositiveButton("Разрешить",(dialog,which)->{
                try{startActivity(new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,Uri.parse("package:"+getPackageName())));}catch(ActivityNotFoundException ignored){}
            }).show();
    }
    private final ActivityResultLauncher<Intent> capture=registerForActivityResult(new ActivityResultContracts.StartActivityForResult(),result->{
        if(result.getResultCode()!=RESULT_OK||result.getData()==null){emit("kva-screen-error","Демонстрация отменена");return;}
        startForegroundService(new Intent(this,ScreenService.class).putExtra("code",result.getResultCode()).putExtra("data",result.getData()));
    });
    @Override public void onCreate(Bundle state){
        super.onCreate(state);current=new WeakReference<>(this);target=intentTarget(getIntent());
        getBridge().getWebView().setWebViewClient(new BridgeWebViewClient(getBridge()){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();
                if("https".equals(uri.getScheme())&&"localhost".equals(uri.getHost())&&(uri.getPort()==-1||uri.getPort()==443))return false;
                String link = appLink(uri);
                if (request.isForMainFrame() && link != null) {view.loadUrl("https://localhost" + link);return true;}
                if(request.isForMainFrame()&&("https".equals(uri.getScheme())||"http".equals(uri.getScheme())))try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(ActivityNotFoundException ignored){}
                return true;
            }
        });
        getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},120);
    }
    @Override public void onResume(){super.onResume();current=new WeakReference<>(this);BackgroundService.visible=true;if(SessionStore.read(this)!=null)startBackground();}
    @Override public void onPause(){BackgroundService.visible=false;super.onPause();}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);target=intentTarget(intent);if(target!=null)emit("kva-open",target);}
    @Override public void onDestroy(){if(directAudio!=null)directAudio.active(false);super.onDestroy();}
    private void startBackground(){startForegroundService(new Intent(this,BackgroundService.class));}
    static void emit(String name,String detail){MainActivity activity=current.get();if(activity!=null)activity.runOnUiThread(()->{
        if(activity.getBridge()!=null)activity.getBridge().getWebView().evaluateJavascript("window.dispatchEvent(new CustomEvent("+JSONObject.quote(name)+",{detail:"+JSONObject.quote(detail)+"}))",null);
    });}
    final class NativeBridge {
        @JavascriptInterface public void directAudio(boolean active){directAudio.active(active);}
        @JavascriptInterface public String audioRoutes(){return directAudio.routes();}
        @JavascriptInterface public boolean selectAudioRoute(String id){return directAudio.select(id);}
        @JavascriptInterface public String readSession(){return SessionStore.read(MainActivity.this);}
        @JavascriptInterface public boolean writeSession(String value){
            try{if(value!=null){JSONObject data=new JSONObject(value);if(value.length()>1048576||data.getString("access_token").isEmpty())return false;}}
            catch(Exception error){return false;}
            boolean result=SessionStore.write(MainActivity.this,value);
            if(result)runOnUiThread(()->{if(value==null){stopService(new Intent(MainActivity.this,BackgroundService.class));stopService(new Intent(MainActivity.this,ScreenService.class));}else{startBackground();offerBackgroundPermission();}});
            return result;
        }
        @JavascriptInterface public String pendingTarget(){String value=target;target="";return value;}
        @JavascriptInterface public String pendingCall(){return BackgroundService.pendingCall;}
        @JavascriptInterface public void clear(String target){if(BackgroundService.instance!=null&&target!=null)BackgroundService.instance.clear(target);}
        @JavascriptInterface public void media(boolean active,boolean camera){runOnUiThread(()->{if(BackgroundService.instance!=null)BackgroundService.instance.media(active,camera);});}
        @JavascriptInterface public void startScreen(){runOnUiThread(()->capture.launch(((MediaProjectionManager)getSystemService(MEDIA_PROJECTION_SERVICE)).createScreenCaptureIntent()));}
        @JavascriptInterface public void stopScreen(){stopService(new Intent(MainActivity.this,ScreenService.class));}
    }
}
