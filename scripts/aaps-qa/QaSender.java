package info.nightscout.androidaps;

import android.app.Activity;
import android.app.BroadcastOptions;
import android.os.Bundle;
import android.content.Intent;
import android.content.Context;
import android.content.pm.ResolveInfo;
import android.util.Log;
import java.util.List;

/** Isolated emulator fixture. No pump, network, sensor or treatment capabilities. */
public final class QaSender extends Activity {
  @Override public void onCreate(Bundle saved) {
    super.onCreate(saved);
    sendStatus(this, getIntent());
    finish();
  }

  static void sendStatus(Context context, Intent args) {
    // Match AAPS's receiver discovery path before targeting the test build.
    List<ResolveInfo> receivers = context.getPackageManager().queryBroadcastReceivers(
      new Intent("info.nightscout.androidaps.status"), 0);
    boolean discovered = false;
    for (ResolveInfo receiver : receivers) {
      if (receiver.activityInfo != null &&
          "io.github.gregorgregor25.t1arc.dev".equals(receiver.activityInfo.packageName)) {
        discovered = true;
        break;
      }
    }
    if (!discovered) {
      Log.w("QaSender", "T1 Arc dev AAPS status receiver not discoverable");
      return;
    }
    Log.i("QaSender", "Discovered T1 Arc dev AAPS status receiver");
    Intent out = new Intent("info.nightscout.androidaps.status")
      .setPackage("io.github.gregorgregor25.t1arc.dev")
      .addFlags(Intent.FLAG_INCLUDE_STOPPED_PACKAGES);
    for (String key : new String[]{"glucoseMgdl", "iob", "bolusIob", "basalIob", "cob", "futureCarbs", "deltaMgdl", "avgDeltaMgdl"}) {
      if (args.hasExtra(key)) out.putExtra(key, Double.parseDouble(args.getStringExtra(key)));
    }
    if (args.hasExtra("glucoseTimeStamp")) out.putExtra("glucoseTimeStamp", Long.parseLong(args.getStringExtra("glucoseTimeStamp")));
    for (String key : new String[]{"units", "slopeArrow"}) {
      if (args.hasExtra(key)) out.putExtra(key, args.getStringExtra(key));
    }
    if (android.os.Build.VERSION.SDK_INT >= 34 && args.getBooleanExtra("shareIdentity", false)) {
      context.sendBroadcast(out, null, BroadcastOptions.makeBasic().setShareIdentityEnabled(true).toBundle());
    } else {
      context.sendBroadcast(out);
    }
  }
}
