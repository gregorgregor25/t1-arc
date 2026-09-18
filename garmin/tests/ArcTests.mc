import Toybox.Test;

(:test)
function freshnessAndUnits(logger) {
    Test.assertEqual(ArcState.compact(null, 1000), "--");
    var data = {"kind"=>"t1arc.glucose", "schemaVersion"=>1, "revision"=>10, "available"=>true, "mmolL"=>6.8, "units"=>"mmol/L", "timestampMs"=>1000000, "sourceHasError"=>false, "trend"=>"flat"};
    Test.assert(ArcState.valid(data));
    Test.assertEqual(ArcState.freshness(data, 1360), "Current");
    Test.assertEqual(ArcState.freshness(data, 1361), "Delayed");
    Test.assertEqual(ArcState.freshness(data, 1720), "Delayed");
    Test.assertEqual(ArcState.freshness(data, 1721), "Old");
    Test.assertEqual(ArcState.freshness(data, 939), "Check clock");
    data["sourceHasError"] = true;
    Test.assertEqual(ArcState.freshness(data, 1000), "Delayed");
    data["units"] = "mg/dL";
    Test.assertEqual(ArcState.numberText(data), "123");
    data["mmolL"] = 99;
    Test.assert(!ArcState.valid(data));
    data["available"] = false;
    Test.assert(ArcState.valid(data));
    Test.assertEqual(ArcState.compact(data, 1000), "--");
    data["schemaVersion"] = 2;
    Test.assert(!ArcState.valid(data));
    return true;
}

(:test)
function orderingAndClear(logger) {
    var previous = ArcState.snapshot();
    var base = previous == null ? 1 : previous["revision"] + 1;
    var data = {"kind"=>"t1arc.glucose", "schemaVersion"=>1, "revision"=>base, "available"=>true, "mmolL"=>6.8, "units"=>"mmol/L", "timestampMs"=>1000000, "sourceHasError"=>false, "trend"=>"flat"};
    Test.assert(ArcState.accept(data, "foreground") != null);
    // A duplicate with different contents must not overwrite the saved reading.
    data = {"kind"=>"t1arc.glucose", "schemaVersion"=>1, "revision"=>base, "available"=>false, "units"=>"mmol/L"};
    Test.assert(ArcState.accept(data, "background") != null);
    Test.assertEqual(ArcState.snapshot()["available"], true);
    data["revision"] = base + 1;
    Test.assert(ArcState.accept(data, "background") != null);
    Test.assertEqual(ArcState.compact(ArcState.snapshot(), 1000), "--");
    data["revision"] = base;
    Test.assert(ArcState.accept(data, "background") == null);
    data["revision"] = base + 2;
    data["kind"] = "other-app";
    Test.assert(ArcState.accept(data, "background") == null);
    Toybox.Application.Storage.setValue("reading", previous);
    return true;
}
