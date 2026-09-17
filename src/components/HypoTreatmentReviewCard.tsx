import { Text, View } from 'react-native';
import { hypoTreatmentReviews } from '@/domain/hypoTreatmentReview';
import { formatGlucose } from '@/domain/regionalFormat';
import { formatTime, formatDate, toDateKey } from '@/domain/time';
import type { TimelineData } from '@/domain/models';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';
import { SectionCard } from './SectionCard';

export function HypoTreatmentReviewCard({ data }: { data: TimelineData }) {
  const { colors } = useAppTheme();
  const { defaults } = useRegionalProfile();
  const reviews = hypoTreatmentReviews(data).slice(-5).reverse();
  if (!reviews.length) return null;
  return <SectionCard><View style={{ gap: 12 }}>
    <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 19, fontWeight: '700' }}>After recorded hypo treatments</Text>
    {reviews.map(({ treatment, before, after, repeatCount }) => <View key={treatment.id} style={{ gap: 6 }}>
      <Text style={{ color: colors.text, fontWeight: '600' }}>{treatment.title} · {formatDate(toDateKey(treatment.start))} {formatTime(treatment.start)}</Text>
      <Text style={{ color: colors.textSecondary }}>{before && after ? `${formatGlucose(before.mmolL, defaults)} at ${formatTime(before.timestamp)} → ${formatGlucose(after.mmolL, defaults)} at ${formatTime(after.timestamp)}` : 'Not enough continuous glucose around this entry to compare readings.'}</Text>
      {repeatCount ? <Text style={{ color: colors.textSecondary }}>{repeatCount} further treatment {repeatCount === 1 ? 'entry' : 'entries'} within the following hour.</Text> : null}
    </View>)}
    <Text style={{ color: colors.textSecondary }}>These are observed readings, not proof of a treatment effect or advice on how much to take. Other food, insulin and activity can also affect them.</Text>
  </View></SectionCard>;
}
