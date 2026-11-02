package ru.kvachat.android;

import android.content.Context;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import java.io.OutputStream;
import java.util.UUID;

/** One bounded download into a document explicitly chosen by the user. */
final class SecretDownloads {
    private final Context context;
    private String id;
    private Uri uri;
    private OutputStream stream;
    private long size, written;
    private int index;
    SecretDownloads(Context context) { this.context=context; }
    synchronized String reserve(long bytes) {
        if(id!=null || bytes<0 || bytes>500L*1024*1024) return null;
        id=UUID.randomUUID().toString(); size=bytes; written=0; index=0; return id;
    }
    synchronized String selected(Uri selected) {
        String request=id;
        if(request==null) return "";
        try {
            if(selected==null) throw new java.io.IOException();
            uri=selected; stream=context.getContentResolver().openOutputStream(uri,"w");
            if(stream==null) throw new java.io.IOException();
            return request;
        } catch(Exception error) { abort(); return ""; }
    }
    synchronized boolean write(String request,int part,String base64) {
        if(id==null || !id.equals(request) || stream==null || part!=index || base64==null || base64.length()>1398104) return false;
        try {
            byte[] data=Base64.decode(base64,Base64.NO_WRAP);
            if(data.length>1024*1024 || written+data.length>size) throw new java.io.IOException();
            stream.write(data); written+=data.length; index++; return true;
        } catch(Exception error) { abort(); return false; }
    }
    synchronized boolean finish(String request,boolean commit) {
        if(id==null || !id.equals(request)) return false;
        if(!commit) { abort(); return true; }
        try {
            if(stream==null || written!=size) throw new java.io.IOException();
            stream.flush(); stream.close(); stream=null; uri=null; id=null; return true;
        } catch(Exception error) { abort(); return false; }
    }
    synchronized void abort() {
        try { if(stream!=null) stream.close(); } catch(Exception ignored) {}
        if(uri!=null) try { DocumentsContract.deleteDocument(context.getContentResolver(),uri); } catch(Exception ignored) {}
        stream=null; uri=null; id=null;
    }
}
