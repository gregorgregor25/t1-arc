export type GlookoImportPhase = 'export' | 'read' | 'save';
let current: { token: object; phase: GlookoImportPhase } | undefined;
const listeners = new Set<() => void>();
export const getGlookoImportPhase = () => current?.phase;
export function subscribeGlookoImportPhase(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function beginGlookoImportProgress() {
  const token = {};
  current = { token, phase: 'export' };
  listeners.forEach(listener => listener());
  return (phase?: GlookoImportPhase) => {
    if (current?.token !== token) return;
    current = phase ? { token, phase } : undefined;
    listeners.forEach(listener => listener());
  };
}
