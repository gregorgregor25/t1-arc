import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8').replace(
    /\r\n/g,
    '\n',
  );
}

describe('History render performance contract', () => {
  it('freezes every retained inactive tab tree', () => {
    const navigator = source('src/navigation/AppNavigator.tsx');

    expect(navigator).toContain('freezeOnBlur: true,');
    expect(navigator).not.toContain('options={{ freezeOnBlur: true }}');
  });

  it('renders a bounded marker series while preserving the denser path series', () => {
    const timeline = source('src/components/CombinedTimeline.tsx');

    expect(timeline).toContain('sampleGlucoseMarkersForChart');
    expect(timeline).toContain('glucoseMarkers.map((reading) => (');
    expect(timeline).not.toContain('sampledGlucose.map((reading) => (');
  });

  it('does not rebuild the dense chart for a foreground clock-only render', () => {
    const history = source('src/screens/HistoryScreen.tsx');
    const timelineHook = source('src/hooks/useTimeline.ts');
    const foodHook = source('src/hooks/useFoodLogs.ts');
    const healthHook = source('src/hooks/useDailyHealthMetrics.ts');

    expect(history).toContain('const HistoryTimeline = memo(CombinedTimeline);');
    expect(history).toContain(
      'const PopulatedHistoryContent = memo(function PopulatedHistoryContent',
    );
    expect(history).toContain('<HistoryTimeline');
    expect(history).toContain('<PopulatedHistoryContent');
    expect(timelineHook).toContain('const latestRange = useRef(range);');
    expect(timelineHook).toContain(
      '}, [rangeKey, repository, revision]);',
    );
    expect(timelineHook).not.toContain(
      '}, [range.end, range.start, rangeKey, repository, revision]);',
    );
    expect(foodHook).toContain('const latestRange = useRef(range);');
    expect(foodHook).toContain('}, [dataMode, requestKey, revision]);');
    expect(foodHook).not.toContain(
      '}, [dataMode, range.end, range.start, requestKey, revision]);',
    );
    expect(healthHook).toContain('const latestRange = useRef(range);');
    expect(healthHook).toContain('}, [dataMode, requestKey, revision]);');
    expect(healthHook).not.toContain(
      '}, [dataMode, range.end, range.start, requestKey, revision]);',
    );
  });
});
