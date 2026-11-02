package ru.kvachat.android;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SessionStore {
    static synchronized String readVault(Context context, String userId) {
        if(userId==null||!userId.matches("[a-f0-9-]{36}"))return null;
        try {
            String slot="secret-vault-"+userId;
            String value=context.getSharedPreferences("secure",0).getString(slot,null);
            if(value==null)return null;
            String[] parts=value.split(":");Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));
            cipher.updateAAD(slot.getBytes(StandardCharsets.UTF_8));
            return new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);
        }catch(Exception error){return null;}
    }
    static synchronized boolean writeVault(Context context,String userId,String value) {
        if(userId==null||!userId.matches("[a-f0-9-]{36}")||(value!=null&&value.length()>8192))return false;
        try {
            String slot="secret-vault-"+userId;
            if(value==null)return context.getSharedPreferences("secure",0).edit().remove(slot).commit();
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
            cipher.updateAAD(slot.getBytes(StandardCharsets.UTF_8));
            return context.getSharedPreferences("secure",0).edit().putString(slot,Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+
                Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP)).commit();
        }catch(Exception error){return false;}
    }
    private static SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias("kva-session")) {
            KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder("kva-session",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey)store.getKey("kva-session",null);
    }
    static synchronized String read(Context context) {
        try {
            String value=context.getSharedPreferences("secure",0).getString("session",null);
            if(value==null)return null;
            String[] parts=value.split(":"); Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));
            return new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);
        }catch(Exception error){return null;}
    }
    static synchronized boolean write(Context context,String value) {
        try {
            if(value==null){return context.getSharedPreferences("secure",0).edit().remove("session").commit();}
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
            return context.getSharedPreferences("secure",0).edit().putString("session",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+
                Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP)).commit();
        }catch(Exception error){return false;}
    }
}
