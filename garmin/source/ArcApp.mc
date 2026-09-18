import Toybox.Application;
import Toybox.Background;
import Toybox.Communications;
import Toybox.Graphics;
import Toybox.System;
import Toybox.Time;
import Toybox.Timer;
import Toybox.WatchUi;

(:background)
class ArcApp extends Application.AppBase {
    function initialize() { AppBase.initialize(); }
    function getInitialView() {
        Background.registerForPhoneAppMessageEvent();
        // Reopening soon after a background event must not break setup.
        if (Background.getTemporalEventRegisteredTime() == null) {
            try { Background.registerForTemporalEvent(new Time.Duration(300)); }
            catch (e) { System.println("ARC temporal registration deferred"); }
        }
        Communications.registerForPhoneAppMessages(method(:onPhone));
        ArcState.publish();
        return [new ArcView(), new ArcDelegate()];
    }
    function onPhone(message) {
        var ack = ArcState.accept(message.data, "foreground");
        if (ack != null) { Communications.transmit(ack, null, new ArcAck(false)); }
        WatchUi.requestUpdate();
    }
    function getServiceDelegate() { return [new ArcService()]; }
}

(:background)
class ArcService extends System.ServiceDelegate {
    function initialize() { ServiceDelegate.initialize(); }
    function onPhoneAppMessage(message) {
        var ack = ArcState.accept(message.data, "background");
        if (ack == null) { Background.exit(null); return; }
        Communications.transmit(ack, null, new ArcAck(true));
    }
    function onTemporalEvent() { ArcState.publish(); Background.exit(null); }
}

(:background)
class ArcAck extends Communications.ConnectionListener {
    var _background;
    function initialize(background) { ConnectionListener.initialize(); _background = background; }
    function onComplete() { if (_background) { Background.exit(null); } }
    function onError() { if (_background) { Background.exit(null); } }
}

class ArcDelegate extends WatchUi.BehaviorDelegate {
    function initialize() { BehaviorDelegate.initialize(); }
    function onBack() { WatchUi.popView(WatchUi.SLIDE_IMMEDIATE); return true; }
}

class ArcView extends WatchUi.View {
    var _timer;
    function initialize() { View.initialize(); }
    function onShow() { _timer = new Timer.Timer(); _timer.start(method(:refresh), 10000, true); }
    function onHide() { if (_timer != null) { _timer.stop(); } }
    function refresh() { WatchUi.requestUpdate(); }
    function line(dc, fraction, font, text) {
        dc.drawText(dc.getWidth()/2, (dc.getHeight()*fraction).toNumber(), font, text, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }
    function onUpdate(dc) {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var data = ArcState.snapshot();
        var state = ArcState.freshness(data, Time.now().value());
        line(dc, 0.20, Graphics.FONT_SMALL, "T1 ARC BETA");
        var value = state.equals("Missing") ? "--" : state.equals("Old") ? "OLD" : state.equals("Check clock") ? "CLOCK" : ArcState.numberText(data);
        line(dc, 0.39, Graphics.FONT_LARGE, value);
        line(dc, 0.55, Graphics.FONT_XTINY, state.equals("Missing") ? "Open T1 Arc on phone" : data["units"] + "  " + ArcState.trendText(data));
        line(dc, 0.66, Graphics.FONT_XTINY, state.equals("Missing") ? "Sources > Garmin" : state + "  " + ArcState.clockText(data));
        line(dc, 0.79, Graphics.FONT_XTINY, "Check reading time");
    }
}
