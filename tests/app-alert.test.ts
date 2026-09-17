import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());

describe('app confirmations', () => {
  it('requires both confirmations and cannot repeat a destructive action on a double tap', async () => {
    const { Alert, getAppAlert, pressAppAlertButton, dismissAppAlert } = await import('@/components/appAlert');
    const erase = vi.fn();
    Alert.alert('Erase data?', 'First confirmation', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Continue', onPress: () => Alert.alert('This cannot be undone', '', [
        { text: 'Keep my data', style: 'cancel' },
        { text: 'Erase this device', style: 'destructive', onPress: erase },
      ]) },
    ]);
    const firstId = getAppAlert()!.id;
    dismissAppAlert(firstId);
    expect(getAppAlert()!.id).toBe(firstId);
    pressAppAlertButton(firstId, 1);
    const secondId = getAppAlert()!.id;
    expect(getAppAlert()!.title).toBe('This cannot be undone');
    expect(erase).not.toHaveBeenCalled();
    pressAppAlertButton(firstId, 1);
    expect(getAppAlert()!.id).toBe(secondId);
    pressAppAlertButton(secondId, 1);
    pressAppAlertButton(secondId, 1);
    expect(erase).toHaveBeenCalledOnce();
    expect(getAppAlert()).toBeUndefined();
  });

  it('cancel and backdrop dismissal never trigger the destructive button', async () => {
    const { Alert, getAppAlert, pressAppAlertButton, dismissAppAlert } = await import('@/components/appAlert');
    const erase = vi.fn();
    const cancel = vi.fn();
    const dismissed = vi.fn();
    const buttons = [{ text: 'Keep', style: 'cancel' as const, onPress: cancel }, { text: 'Erase', style: 'destructive' as const, onPress: erase }];
    Alert.alert('Erase?', '', buttons, { cancelable: true, onDismiss: dismissed });
    dismissAppAlert(getAppAlert()!.id);
    expect(dismissed).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    Alert.alert('Erase?', '', buttons);
    pressAppAlertButton(getAppAlert()!.id, 0);
    expect(cancel).toHaveBeenCalledOnce();
    expect(erase).not.toHaveBeenCalled();
  });

  it('keeps a second error available instead of losing it behind the current dialog', async () => {
    const { Alert, getAppAlert, pressAppAlertButton, subscribeAppAlert } = await import('@/components/appAlert');
    const changed = vi.fn();
    const unsubscribe = subscribeAppAlert(changed);
    Alert.alert('First error');
    const firstId = getAppAlert()!.id;
    Alert.alert('Second error');
    expect(getAppAlert()!.title).toBe('First error');
    expect(getAppAlert()!.buttons[0]!.text).toBe('OK');
    pressAppAlertButton(firstId, 0);
    expect(getAppAlert()!.title).toBe('Second error');
    expect(changed).toHaveBeenCalledTimes(3);
    unsubscribe();
    pressAppAlertButton(getAppAlert()!.id, 0);
    expect(changed).toHaveBeenCalledTimes(3);
  });
});
