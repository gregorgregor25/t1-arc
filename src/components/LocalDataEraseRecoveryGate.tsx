import { PropsWithChildren, useEffect, useState } from 'react';

import { resumePendingLocalDataErase } from '@/data/privacy/localDataVault';

/** Prevents source configuration from publishing while an erase is recovering. */
export function LocalDataEraseRecoveryGate({
  children,
}: PropsWithChildren) {
  const [state, setState] = useState<
    { ready: true; error?: never } | { ready: false; error?: Error }
  >({ ready: false });

  useEffect(() => {
    let mounted = true;
    resumePendingLocalDataErase().then(
      () => {
        if (mounted) setState({ ready: true });
      },
      (error: unknown) => {
        if (!mounted) return;
        setState({
          ready: false,
          error:
            error instanceof Error
              ? error
              : new Error('The interrupted local-data erase could not resume.'),
        });
      },
    );
    return () => {
      mounted = false;
    };
  }, []);

  if (state.error) throw state.error;
  return state.ready ? children : null;
}
