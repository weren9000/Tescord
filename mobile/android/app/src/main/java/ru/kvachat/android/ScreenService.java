package ru.kvachat.android;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;
import android.graphics.*;
import android.hardware.display.*;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.*;
import android.util.Base64;
import androidx.core.app.NotificationCompat;
import java.io.ByteArrayOutputStream;

public class ScreenService extends Service {
    private MediaProjection projection;
    private VirtualDisplay display;
    private ImageReader reader;
    private HandlerThread thread;
    private Handler handler;
    private long lastFrame;
    private int width,height;
    @Override public int onStartCommand(Intent intent,int flags,int id){
        if(intent==null||"stop".equals(intent.getAction())){stopSelf();return START_NOT_STICKY;}
        if(projection!=null)return START_NOT_STICKY;
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("screen","Демонстрация экрана",NotificationManager.IMPORTANCE_LOW));
        Intent stop=new Intent(this,ScreenService.class).setAction("stop");
        startForeground(2,new NotificationCompat.Builder(this,"screen").setSmallIcon(R.drawable.ic_notification).setContentTitle("Вы показываете экран")
            .setOngoing(true).setContentIntent(BackgroundService.open(this,""))
            .addAction(0,"Остановить",PendingIntent.getService(this,2,stop,PendingIntent.FLAG_IMMUTABLE)).build(),ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        try {
            Intent data=intent.getParcelableExtra("data");
            projection=((MediaProjectionManager)getSystemService(MEDIA_PROJECTION_SERVICE)).getMediaProjection(intent.getIntExtra("code",Activity.RESULT_CANCELED),data);
            thread=new HandlerThread("KvaScreen");thread.start();handler=new Handler(thread.getLooper());
            projection.registerCallback(new MediaProjection.Callback(){
                @Override public void onStop(){stopSelf();}
                @Override public void onCapturedContentResize(int w,int h){handler.post(()->resize(w,h));}
            },handler);
            MainActivity.emit("kva-screen-started","");
            android.util.DisplayMetrics metrics=getResources().getDisplayMetrics();
            handler.post(()->{try{resize(metrics.widthPixels,metrics.heightPixels);}catch(Exception error){MainActivity.emit("kva-screen-error","Не удалось получить изображение экрана");stopSelf();}});
        }catch(Exception error){MainActivity.emit("kva-screen-error","Не удалось включить демонстрацию");stopSelf();}
        return START_NOT_STICKY;
    }
    private void resize(int originalWidth,int originalHeight){
        if(projection==null||originalWidth<=0||originalHeight<=0)return;
        double scale=Math.min(1.0,960.0/Math.max(originalWidth,originalHeight));
        int w=Math.max(2,(int)(originalWidth*scale)),h=Math.max(2,(int)(originalHeight*scale));
        if(w==width&&h==height&&reader!=null)return;width=w;height=h;
        ImageReader next=ImageReader.newInstance(w,h,PixelFormat.RGBA_8888,2);
        next.setOnImageAvailableListener(source->{
            try(Image image=source.acquireLatestImage()){
                if(image==null||SystemClock.elapsedRealtime()-lastFrame<125)return;lastFrame=SystemClock.elapsedRealtime();
                Image.Plane plane=image.getPlanes()[0];int stride=plane.getPixelStride(),row=plane.getRowStride();
                Bitmap padded=Bitmap.createBitmap(row/stride,image.getHeight(),Bitmap.Config.ARGB_8888);padded.copyPixelsFromBuffer(plane.getBuffer());
                Bitmap bitmap=Bitmap.createBitmap(padded,0,0,image.getWidth(),image.getHeight());
                ByteArrayOutputStream bytes=new ByteArrayOutputStream();bitmap.compress(Bitmap.CompressFormat.JPEG,65,bytes);
                MainActivity.emit("kva-screen-frame",Base64.encodeToString(bytes.toByteArray(),Base64.NO_WRAP));
                if(bitmap!=padded)bitmap.recycle();padded.recycle();
            }catch(Exception ignored){}
        },handler);
        if(display==null)display=projection.createVirtualDisplay("KvaChat",w,h,getResources().getDisplayMetrics().densityDpi,DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,next.getSurface(),null,handler);
        else{display.resize(w,h,getResources().getDisplayMetrics().densityDpi);display.setSurface(next.getSurface());}
        if(reader!=null)reader.close();reader=next;
    }
    @Override public void onDestroy(){
        if(display!=null)display.release();if(reader!=null)reader.close();
        MediaProjection old=projection;projection=null;if(old!=null)old.stop();
        if(thread!=null)thread.quitSafely();MainActivity.emit("kva-screen-ended","");super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent){return null;}
}
