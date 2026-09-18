import Toybox.Application;
import Toybox.Background;
import Toybox.Communications;
import Toybox.Complications;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;
import Toybox.WatchUi;

// Simulator-only experiment. Accepts synthetic data exclusively.
(:background)
module ProbeState {
    function snapshot() { return Application.Storage.getValue("snapshot"); }

    function text() {
        var data = snapshot();
        if (data == null || data["available"] != true) { return "--"; }
        var age = Time.now().value() - (data["timestampMs"] / 1000).toNumber();
        if (age < -60) { return "CLOCK"; }
        if (age > 720) { return "OLD"; }
        var value = data["mmolL"].format("%.1f");
        return (age > 360 || data["sourceHasError"] == true) ? value + " D" : value;
    }

    function publish() {
        var value = text();
        Complications.updateComplication(0, {:value => value, :shortLabel => "TEST", :unit => Complications.UNIT_INVALID});
        System.println("PROBE_PUBLISH value=" + value);
        return value;
    }

    function accept(data, route) {
        if (!(data instanceof Dictionary) || data["synthetic"] != true || data["schemaVersion"] != 1) {
            System.println("PROBE_REJECT schema");
            return null;
        }
        var revision = data["revision"];
        if ((!(revision instanceof Number) && !(revision instanceof Long)) || revision <= 0) { return null; }
        var previous = snapshot();
        if (previous != null && revision < previous["revision"]) {
            System.println("PROBE_REJECT old revision=" + revision);
            return null;
        }
        if (previous != null && revision == previous["revision"]) {
            // A lost acknowledgement must not force the phone to invent new data.
            System.println("PROBE_DUPLICATE revision=" + revision);
            return {"revision" => revision, "value" => text(), "route" => route};
        }
        if (data["available"] == true) {
            var value = data["mmolL"];
            var stamp = data["timestampMs"];
            if (!(value instanceof Float) && !(value instanceof Double) && !(value instanceof Number)) { return null; }
            if (!(stamp instanceof Number) && !(stamp instanceof Long)) { return null; }
            if (!(value >= 0.5 && value <= 40.0) || stamp <= 0) { return null; }
        } else if (data["available"] != false) { return null; }
        Application.Storage.setValue("snapshot", data);
        var published = publish();
        System.println("PROBE_RECEIVE route=" + route + " revision=" + revision);
        return {"revision" => revision, "value" => published, "route" => route};
    }
}

(:background)
class ProbeApp extends Application.AppBase {
    function initialize() { AppBase.initialize(); }
    function getInitialView() {
        Background.registerForPhoneAppMessageEvent();
        Background.registerForTemporalEvent(new Time.Duration(300));
        Communications.registerForPhoneAppMessages(method(:onPhone));
        ProbeState.publish();
        return [new ProbeView(), new ProbeDelegate()];
    }
    function onPhone(msg) {
        var ack = ProbeState.accept(msg.data, "foreground");
        if (ack != null) { Communications.transmit(ack, null, new ProbeAck(false)); }
        WatchUi.requestUpdate();
    }
    function getServiceDelegate() { return [new ProbeService()]; }
}

class ProbeDelegate extends WatchUi.BehaviorDelegate {
    function initialize() { BehaviorDelegate.initialize(); }
    function onBack() { WatchUi.popView(WatchUi.SLIDE_IMMEDIATE); return true; }
}

(:background)
class ProbeService extends System.ServiceDelegate {
    function initialize() { ServiceDelegate.initialize(); }
    function onPhoneAppMessage(msg) {
        var ack = ProbeState.accept(msg.data, "background");
        if (ack == null) { Background.exit(null); return; }
        Communications.transmit(ack, null, new ProbeAck(true));
    }
    function onTemporalEvent() { ProbeState.publish(); Background.exit(null); }
}

(:background)
class ProbeAck extends Communications.ConnectionListener {
    var _background;
    function initialize(background) { ConnectionListener.initialize(); _background = background; }
    function onComplete() {
        System.println("PROBE_ACK sent");
        if (_background) { Background.exit(null); }
    }
    function onError() {
        System.println("PROBE_ACK failed");
        if (_background) { Background.exit(null); }
    }
}

class ProbeView extends WatchUi.View {
    function initialize() { View.initialize(); }
    function onUpdate(dc) {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        dc.drawText(dc.getWidth()/2, 95, Graphics.FONT_SMALL, "SYNTHETIC TEST", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(dc.getWidth()/2, 155, Graphics.FONT_LARGE, ProbeState.text(), Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(dc.getWidth()/2, 240, Graphics.FONT_XTINY, "mmol/L | T1 Arc probe", Graphics.TEXT_JUSTIFY_CENTER);
    }
}
