import type { AlertButton, AlertOptions } from 'react-native';

interface AppDialog {
  id: number;
  title: string;
  message?: string;
  buttons: AlertButton[];
  options?: AlertOptions;
}

let nextId = 0;
let queue: AppDialog[] = [];
const listeners = new Set<() => void>();
const publish = () => listeners.forEach(listener => listener());

export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions) {
    queue = [...queue, {
      id: ++nextId, title, message, options,
      buttons: buttons?.length ? [...buttons] : [{ text: 'OK' }],
    }];
    publish();
  },
};

export function subscribeAppAlert(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getAppAlert() { return queue[0]; }

export function pressAppAlertButton(id: number, index: number) {
  const current = queue[0];
  if (current?.id !== id || !current.buttons[index]) return;
  const action = current.buttons[index];
  // Remove first: double taps cannot repeat an action, and callbacks may open
  // a second confirmation without the first one's dismissal clearing it.
  queue = queue.slice(1);
  publish();
  action.onPress?.();
}

export function dismissAppAlert(id: number) {
  const current = queue[0];
  if (current?.id !== id || !current.options?.cancelable) return;
  queue = queue.slice(1);
  publish();
  current.options.onDismiss?.();
}
