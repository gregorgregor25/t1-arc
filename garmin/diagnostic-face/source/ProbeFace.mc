import Toybox.Application;
import Toybox.Complications;
import Toybox.Graphics;
import Toybox.System;
import Toybox.WatchUi;

// Development-only consumer fixture, not a proposed shipping watch face.
class ProbeFaceApp extends Application.AppBase {
    var _view;
    function initialize() { AppBase.initialize(); }
    function getInitialView() { _view = new ProbeFace(); return [_view]; }
}

class ProbeFace extends WatchUi.WatchFace {
    var _id;
    var _value = "No publisher";
    var _units = "Open T1 Arc Beta first";
    function initialize() {
        WatchFace.initialize();
        Complications.registerComplicationChangeCallback(method(:changed));
        var iterator = Complications.getComplications();
        var item = iterator.next();
        while (item != null) {
            if (item.longLabel != null && item.longLabel.equals("T1 Arc glucose (beta)")) {
                _id = item.complicationId;
                Complications.subscribeToUpdates(_id);
                changed(_id);
                break;
            }
            item = iterator.next();
        }
    }
    function changed(id) {
        try {
            var item = Complications.getComplication(id);
            _value = item.value == null ? "--" : item.value.toString();
            _units = item.shortLabel == null ? "Glucose" : item.shortLabel;
            System.println("CONSUMER_VALUE " + _value);
        } catch (e) { _value = "Missing"; }
        WatchUi.requestUpdate();
    }
    function onUpdate(dc) {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        dc.drawText(dc.getWidth()/2, 100, Graphics.FONT_SMALL, "T1 ARC DIAGNOSTIC", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(dc.getWidth()/2, 160, Graphics.FONT_SMALL, _value, Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(dc.getWidth()/2, 245, Graphics.FONT_XTINY, _units, Graphics.TEXT_JUSTIFY_CENTER);
    }
}
