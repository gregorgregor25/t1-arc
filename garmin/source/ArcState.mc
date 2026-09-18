import Toybox.Application;
import Toybox.Complications;
import Toybox.Lang;
import Toybox.Math;
import Toybox.System;
import Toybox.Time;
import Toybox.Time.Gregorian;

(:background)
module ArcState {
    function snapshot() { return Application.Storage.getValue("reading"); }
    function notString(value) { return !(value instanceof String); }
    function integer(value) { return value instanceof Number || value instanceof Long; }

    // Validate before comparing revisions, including duplicate messages.
    function valid(data) {
        if (!(data instanceof Dictionary) || (notString(data["kind"]) || !data["kind"].equals("t1arc.glucose")) || data["schemaVersion"] != 1) { return false; }
        if (!integer(data["revision"]) || data["revision"] <= 0) { return false; }
        if (notString(data["units"]) || (!data["units"].equals("mmol/L") && !data["units"].equals("mg/dL"))) { return false; }
        if (data["available"] == false) { return true; }
        if (data["available"] != true || !(data["sourceHasError"] instanceof Boolean)) { return false; }
        var value = data["mmolL"];
        if (!(value instanceof Float) && !(value instanceof Double) && !(value instanceof Number)) { return false; }
        if (!(value >= 0.5 && value <= 40.0)) { return false; }
        if (!integer(data["timestampMs"]) || data["timestampMs"] <= 0) { return false; }
        if (notString(data["trend"])) { return false; }
        var trends = {"doubleDown"=>true, "down"=>true, "slightDown"=>true, "flat"=>true, "slightUp"=>true, "up"=>true, "doubleUp"=>true, "unknown"=>true};
        return trends[data["trend"]] == true;
    }

    function freshness(data, now) {
        if (data == null || data["available"] != true) { return "Missing"; }
        var age = now - (data["timestampMs"] / 1000).toNumber();
        if (age < -60) { return "Check clock"; }
        if (age > 720) { return "Old"; }
        if (age > 360 || data["sourceHasError"] == true) { return "Delayed"; }
        return "Current";
    }

    function numberText(data) {
        return data["units"].equals("mg/dL") ? Math.round(data["mmolL"] * 18.0182).toNumber().toString() : data["mmolL"].format("%.1f");
    }

    function clockText(data) {
        if (data == null || data["available"] != true) { return ""; }
        var time = Gregorian.info(new Time.Moment((data["timestampMs"] / 1000).toNumber()), Time.FORMAT_SHORT);
        return time.hour.format("%02d") + ":" + time.min.format("%02d");
    }

    function trendText(data) {
        var symbols = {"doubleDown"=>"vv", "down"=>"v", "slightDown"=>"\\", "flat"=>">", "slightUp"=>"/", "up"=>"^", "doubleUp"=>"^^", "unknown"=>"?"};
        return symbols[data["trend"]];
    }

    function compact(data, now) {
        var state = freshness(data, now);
        if (state.equals("Missing")) { return "--"; }
        if (state.equals("Check clock")) { return "CLOCK"; }
        if (state.equals("Old")) { return "OLD " + clockText(data); }
        // Always include measurement time: another face may cache this text.
        return numberText(data) + (state.equals("Delayed") ? " D " : " " + trendText(data) + " ") + clockText(data);
    }

    function publish() {
        var data = snapshot();
        Complications.updateComplication(0, {:value => compact(data, Time.now().value()), :shortLabel => data == null ? "Glucose" : data["units"], :unit => Complications.UNIT_INVALID});
    }

    function accept(data, route) {
        if (!valid(data)) { return null; }
        var previous = snapshot();
        if (previous != null && data["revision"] < previous["revision"]) { return null; }
        if (previous == null || data["revision"] > previous["revision"]) {
            Application.Storage.setValue("reading", data);
        }
        publish();
        return {"kind"=>"t1arc.ack", "schemaVersion"=>1, "revision"=>data["revision"], "route"=>route};
    }
}
