package info.nightscout.androidaps;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Emulator-only trigger; forwards typed AAPS status without opening a screen. */
public final class QaSenderReceiver extends BroadcastReceiver {
  @Override public void onReceive(Context context, Intent intent) {
    if (intent != null && "info.nightscout.androidaps.qa.SEND".equals(intent.getAction())) {
      QaSender.sendStatus(context, intent);
    }
  }
}
