package app.t1arc.garminprobe;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.widget.TextView;
import com.garmin.android.connectiq.ConnectIQ;
import com.garmin.android.connectiq.IQApp;
import com.garmin.android.connectiq.IQDevice;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.List;
import org.json.JSONObject;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Isolated, synthetic-data-only TETHERED test. Not a production bridge. */
public final class ProbeActivity extends Activity {
    public static final String WATCH_ID = "d8285c0afe7d4945892e9600a5b108e5";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService transport = Executors.newSingleThreadExecutor();
    private final Set<Long> registered = new HashSet<>();
    private final Map<Long, Long> sentRevision = new HashMap<>();
    private final Map<Long, Long> acknowledgedRevision = new HashMap<>();
    private final Map<Long, Long> lastAttempt = new HashMap<>();
    private final Map<Long, Integer> attempts = new HashMap<>();
    private final Map<Long, Long> timedOutRevision = new HashMap<>();
    private final IQApp watchApp = new IQApp(WATCH_ID);
    private ConnectIQ sdk;
    private TextView output;
    private boolean ready;
    private long revision;
    private Map<String, Object> payload;
    private final StringBuilder transcript = new StringBuilder();

    private void report(String text) {
        Log.i("GarminProbe", text);
        runOnUiThread(() -> {
            transcript.append(text).append('\n');
            if (transcript.length() > 6000) transcript.delete(0, 2000);
            output.setText("SYNTHETIC GLUCOSE TEST\nTETHERED / ADB :7381\n\n" + transcript);
        });
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        output = new TextView(this);
        output.setPadding(24, 64, 24, 24);
        output.setTextSize(16);
        setContentView(output);
        if (getIntent().getExtras() == null && getPreferences(MODE_PRIVATE).contains("snapshot")) {
            restoreScenario();
        } else { readScenario(getIntent()); }
        sdk = ConnectIQ.getInstance(this, ConnectIQ.IQConnectType.TETHERED);
        sdk.setAdbPort(7381);
        sdk.initialize(this, false, new ConnectIQ.ConnectIQListener() {
            @Override public void onSdkReady() {
                ready = true;
                report("SDK_READY (no Garmin Connect required for this tethered test)");
                handler.post(poll);
            }
            @Override public void onInitializeError(ConnectIQ.IQSdkErrorStatus status) {
                report("SDK_ERROR " + status);
            }
            @Override public void onSdkShutDown() { ready = false; report("SDK_SHUTDOWN"); }
        });
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        readScenario(intent);
    }

    private void readScenario(Intent intent) {
        if (intent.getBooleanExtra("replay", false) && payload != null) {
            sentRevision.clear(); acknowledgedRevision.clear(); attempts.clear();
            report("REPLAY revision=" + revision);
            return;
        }
        revision = System.currentTimeMillis();
        payload = new HashMap<>();
        payload.put("schemaVersion", 1);
        payload.put("revision", revision);
        payload.put("available", !intent.getBooleanExtra("missing", false));
        payload.put("mmolL", intent.hasExtra("mmolL") ? (double) intent.getFloatExtra("mmolL", 6.8f) : 6.8);
        payload.put("timestampMs", revision - intent.getLongExtra("ageSeconds", 0) * 1000);
        payload.put("trend", "flat");
        payload.put("trendOrigin", "source");
        payload.put("sourceHasError", intent.getBooleanExtra("sourceError", false));
        payload.put("synthetic", true);
        getPreferences(MODE_PRIVATE).edit().putString("snapshot", new JSONObject(payload).toString()).apply();
        report("SCENARIO " + payload);
    }

    private void restoreScenario() {
        try {
            JSONObject stored = new JSONObject(getPreferences(MODE_PRIVATE).getString("snapshot", "{}"));
            payload = new HashMap<>();
            java.util.Iterator<String> keys = stored.keys();
            while (keys.hasNext()) { String key = keys.next(); payload.put(key, stored.get(key)); }
            revision = ((Number) payload.get("revision")).longValue();
            report("RESTORED " + payload);
        } catch (Exception e) { report("RESTORE_ERROR " + e); readScenario(new Intent()); }
    }

    private void receiveAck(IQDevice device, List<Object> messages, ConnectIQ.IQMessageStatus status) {
        report("WATCH_ACK " + status + " " + messages);
        if (status != ConnectIQ.IQMessageStatus.SUCCESS || messages == null) return;
        for (Object message : messages) {
            if (!(message instanceof Map)) continue;
            Map<?, ?> ack = (Map<?, ?>) message;
            Object ackRevision = ack.get("revision");
            Object route = ack.get("route");
            if (!(ackRevision instanceof Number) || !(ack.get("value") instanceof String) ||
                !("foreground".equals(route) || "background".equals(route))) continue;
            long received = ((Number) ackRevision).longValue();
            if (received == revision && Long.valueOf(received).equals(sentRevision.get(device.getDeviceIdentifier()))) {
                acknowledgedRevision.put(device.getDeviceIdentifier(), received);
                report("CONFIRMED revision=" + received + " route=" + route + " value=" + ack.get("value"));
            } else { report("IGNORED_ACK revision=" + received); }
        }
    }

    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (!ready) return;
            try {
                for (IQDevice device : sdk.getKnownDevices()) {
                    if (registered.add(device.getDeviceIdentifier())) {
                        report("DEVICE " + device.getFriendlyName() + " id=" + device.getDeviceIdentifier());
                        sdk.registerForDeviceEvents(device, (d, status) -> {
                            report("DEVICE_STATUS " + status);
                            if (status != IQDevice.IQDeviceStatus.CONNECTED) {
                                sentRevision.remove(d.getDeviceIdentifier());
                                acknowledgedRevision.remove(d.getDeviceIdentifier());
                                attempts.remove(d.getDeviceIdentifier());
                            }
                        });
                        sdk.registerForAppEvents(device, watchApp, (d, app, message, status) ->
                            receiveAck(d, message, status));
                        // The simulator may omit the sender UUID. TETHERED test only.
                        sdk.registerForAppEvents(device, new IQApp(""), (d, app, message, status) ->
                            receiveAck(d, message, status));
                    }
                    long id = device.getDeviceIdentifier();
                    boolean sameRevision = Long.valueOf(revision).equals(sentRevision.get(id));
                    boolean confirmed = Long.valueOf(revision).equals(acknowledgedRevision.get(id));
                    int count = sameRevision ? attempts.getOrDefault(id, 0) : 0;
                    if (!confirmed && sameRevision && count >= 3 &&
                        SystemClock.elapsedRealtime() - lastAttempt.getOrDefault(id, 0L) >= 10000 &&
                        !Long.valueOf(revision).equals(timedOutRevision.get(id))) {
                        timedOutRevision.put(id, revision);
                        report("UNCONFIRMED revision=" + revision + " after 3 attempts; waiting for reconnect or newer data");
                    }
                    if (sdk.getDeviceStatus(device) == IQDevice.IQDeviceStatus.CONNECTED &&
                        !confirmed && count < 3 && (!sameRevision ||
                        SystemClock.elapsedRealtime() - lastAttempt.getOrDefault(id, 0L) >= 10000)) {
                        final long sending = revision;
                        sentRevision.put(device.getDeviceIdentifier(), sending);
                        attempts.put(id, count + 1);
                        lastAttempt.put(id, SystemClock.elapsedRealtime());
                        report("SEND_ATTEMPT revision=" + sending + " attempt=" + (count + 1));
                        final Map<String, Object> snapshot = new HashMap<>(payload);
                        transport.execute(() -> {
                            try {
                                sdk.sendMessage(device, watchApp, snapshot, (d, app, status) -> {
                                    report("SEND_RESULT revision=" + sending + " " + status);
                                    if (status != ConnectIQ.IQMessageStatus.SUCCESS) {
                                        report("UNCONFIRMED revision=" + sending);
                                    }
                                });
                            } catch (Exception e) {
                                report("SEND_ERROR revision=" + sending + " " + e);
                                report("UNCONFIRMED revision=" + sending);
                            }
                        });
                    }
                }
            } catch (Exception e) { report("POLL_ERROR " + e); }
            handler.postDelayed(this, 3000);
        }
    };

    @Override protected void onDestroy() {
        handler.removeCallbacks(poll);
        transport.shutdownNow();
        if (sdk != null && ready) {
            try { sdk.shutdown(this); } catch (Exception e) { Log.w("GarminProbe", "shutdown", e); }
        }
        super.onDestroy();
    }
}
