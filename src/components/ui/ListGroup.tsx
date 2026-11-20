import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { useAppTheme } from '@/theme/theme';

import { flatSurfaceStyle } from './surface';

export interface ListGroupProps {
  /** Optional small-caps label above the card, for example "Privacy". */
  label?: string;
  /** Rows (usually `ListRow` or `StatusLine`). Empty slots are skipped. */
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A card holding a short list of rows with thin dividers between them, with an
 * optional small-caps label above. The label is a screen-reader heading; it is
 * written in sentence case and only displayed in capitals.
 */
export function ListGroup({ label, children, style, testID }: ListGroupProps) {
  const theme = useAppTheme();
  const { colors, type } = theme;
  const rows = Children.toArray(children).filter(isValidElement);

  return (
    <View style={[styles.group, style]} testID={testID}>
      {label ? (
        <Text
          accessibilityRole="header"
          style={[styles.label, { color: colors.textTertiary, fontSize: type.footnote }]}
        >
          {label}
        </Text>
      ) : null}
      <View style={[styles.card, flatSurfaceStyle(theme)]}>
        {rows.map((row, index) => (
          <Fragment key={row.key ?? index}>
            {index > 0 ? (
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={[styles.divider, { backgroundColor: colors.border }]}
                testID="list-group-divider"
              />
            ) : null}
            {row}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: 6,
  },
  label: {
    fontWeight: '700',
    letterSpacing: 0.4,
    lineHeight: 18,
    paddingTop: 6,
    textTransform: 'uppercase',
  },
  card: {
    paddingHorizontal: 16,
    paddingVertical: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
});
