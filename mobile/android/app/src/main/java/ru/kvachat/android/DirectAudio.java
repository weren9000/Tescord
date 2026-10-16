package ru.kvachat.android;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;

/** Owns routing only while a direct call is active. Group calls never enter this controller. */
final class DirectAudio {
    private final AudioManager audio;
    private boolean active;
    private int previousMode;
    private boolean previousSpeaker;
    private AudioDeviceInfo previousDevice;
    DirectAudio(Context context) { audio = context.getSystemService(AudioManager.class); }
    synchronized void active(boolean value) {
        if (value == active) return;
        if (value) {
            previousMode = audio.getMode();
            previousSpeaker = audio.isSpeakerphoneOn();
            if (Build.VERSION.SDK_INT >= 31) previousDevice = audio.getCommunicationDevice();
            audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
            active = true;
        } else {
            if (Build.VERSION.SDK_INT >= 31) {
                audio.clearCommunicationDevice();
                if (previousMode == AudioManager.MODE_IN_COMMUNICATION && previousDevice != null
                    && audio.getAvailableCommunicationDevices().contains(previousDevice)) audio.setCommunicationDevice(previousDevice);
            } else audio.setSpeakerphoneOn(previousSpeaker);
            audio.setMode(previousMode);
            active = false;
        }
    }
    synchronized String routes() {
        JSONArray rows = new JSONArray();
        if (!active) return rows.toString();
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                AudioDeviceInfo current = audio.getCommunicationDevice();
                for (AudioDeviceInfo device : audio.getAvailableCommunicationDevices()) {
                    String label = device.getType() == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE ? "Телефон"
                        : device.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER ? "Динамик" : device.getProductName().toString();
                    rows.put(new JSONObject().put("id", String.valueOf(device.getId())).put("label", label)
                        .put("selected", current != null && current.getId() == device.getId()));
                }
            } else {
                rows.put(new JSONObject().put("id", "auto").put("label", "Телефон / наушники").put("selected", !audio.isSpeakerphoneOn()));
                rows.put(new JSONObject().put("id", "speaker").put("label", "Динамик").put("selected", audio.isSpeakerphoneOn()));
            }
        } catch (Exception ignored) { }
        return rows.toString();
    }
    synchronized boolean select(String id) {
        if (!active) return false;
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                for (AudioDeviceInfo device : audio.getAvailableCommunicationDevices())
                    if (String.valueOf(device.getId()).equals(id)) return audio.setCommunicationDevice(device);
                return false;
            }
            if (!"auto".equals(id) && !"speaker".equals(id)) return false;
            audio.setSpeakerphoneOn("speaker".equals(id));
            return true;
        } catch (Exception ignored) { return false; }
    }
}
