import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../src/components/foodLogger/FoodLabelCaptureModal.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('FoodLabelCaptureModal.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers: string[] = [];
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && ['capture', 'close', 'requestCameraAccess', 'handleAppStateChange'].includes(node.name?.text ?? '')) handlers.push(node.getText(parsed));
  ts.forEachChild(node, visit);
}
visit(parsed);
if (handlers.length !== 4) throw new Error('Capture interaction handlers were not found.');
const compiled = ts.transpileModule(`${handlers.join('\n')}\nexport { capture, close, requestCameraAccess, handleAppStateChange };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function captureFlow() {
  const scope = {
    exports: {}, Error, camera: { current: { takePictureAsync: vi.fn().mockResolvedValue({ uri: 'synthetic-photo' }) } },
    generation: { current: 0 }, captureLock: { current: false }, ready: true,
    sessionActive: { current: true }, foreground: { current: true },
    permissionRoundTrip: { current: false }, permissionRequestInFlight: { current: false },
    permission: { canAskAgain: true }, requestPermission: vi.fn().mockResolvedValue({ granted: true }),
    Linking: { openSettings: vi.fn() }, setPermissionPending: vi.fn(), setAppActive: vi.fn(), setReady: vi.fn(),
    setBusy: vi.fn(), setError: vi.fn(), setDraft: vi.fn(), setTorch: vi.fn(), onClose: vi.fn(), onResult: vi.fn(),
    recognizeFoodLabelPhoto: vi.fn().mockResolvedValue({ fields: { serving: 100, unit: 'g', carbs: 20 } }),
    discardFoodLabelPhoto: vi.fn().mockResolvedValue(undefined),
  };
  runInNewContext(compiled, scope);
  return { scope, call: scope.exports as { capture(): Promise<void>; close(): void;
    requestCameraAccess(): Promise<void>; handleAppStateChange(state: string): void } };
}

function deferred<T>() {
  let finish!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { finish = resolve; });
  return { promise, finish };
}

describe('label capture lifecycle interactions', () => {
  it('creates only a review draft, with no result callback or auto-save, then removes the temporary photo', async () => {
    const flow = captureFlow();
    await flow.call.capture();
    expect(flow.scope.setDraft).toHaveBeenCalledOnce();
    expect(flow.scope.onResult).not.toHaveBeenCalled();
    expect(flow.scope.discardFoodLabelPhoto).toHaveBeenCalledWith('synthetic-photo');
    expect(flow.scope.camera.current.takePictureAsync).toHaveBeenCalledWith(expect.objectContaining({ exif: false, base64: false, skipProcessing: false }));
  });

  it('discards a photo that arrives after close without recognizing it', async () => {
    const flow = captureFlow();
    const photo = deferred<{ uri: string }>();
    flow.scope.camera.current.takePictureAsync.mockReturnValue(photo.promise);
    const pending = flow.call.capture();
    flow.call.close();
    photo.finish({ uri: 'late-photo' });
    await pending;
    expect(flow.scope.recognizeFoodLabelPhoto).not.toHaveBeenCalled();
    expect(flow.scope.setDraft).not.toHaveBeenCalled();
    expect(flow.scope.discardFoodLabelPhoto).toHaveBeenCalledWith('late-photo');
  });

  it('does not publish an OCR result that completes after close', async () => {
    const flow = captureFlow();
    const recognition = deferred<{ fields: object }>();
    flow.scope.recognizeFoodLabelPhoto.mockReturnValue(recognition.promise);
    const pending = flow.call.capture();
    await vi.waitFor(() => expect(flow.scope.recognizeFoodLabelPhoto).toHaveBeenCalledOnce());
    flow.call.close();
    recognition.finish({ fields: {} });
    await pending;
    expect(flow.scope.setDraft).not.toHaveBeenCalled();
    expect(flow.scope.onResult).not.toHaveBeenCalled();
    expect(flow.scope.discardFoodLabelPhoto).toHaveBeenCalledOnce();
  });

  it('allows only one in-flight capture and keeps unreadable error details private', async () => {
    const flow = captureFlow();
    const photo = deferred<{ uri: string }>();
    flow.scope.camera.current.takePictureAsync.mockReturnValue(photo.promise);
    flow.scope.recognizeFoodLabelPhoto.mockRejectedValue(new Error('private OCR detail'));
    const pending = flow.call.capture();
    await flow.call.capture();
    expect(flow.scope.camera.current.takePictureAsync).toHaveBeenCalledOnce();
    photo.finish({ uri: 'synthetic-photo' });
    await pending;
    expect(flow.scope.setError).toHaveBeenLastCalledWith(expect.stringContaining('Retake it in good light'));
    expect(flow.scope.setError).not.toHaveBeenCalledWith(expect.stringContaining('private'));
    expect(flow.scope.captureLock.current).toBe(false);
  });

  it('does not capture before the camera is ready', async () => {
    const flow = captureFlow();
    flow.scope.ready = false;
    await flow.call.capture();
    expect(flow.scope.camera.current.takePictureAsync).not.toHaveBeenCalled();
  });

  it('preserves the Android permission round-trip when permission resolves before the active event', async () => {
    const flow = captureFlow();
    const permission = deferred<{ granted: boolean }>();
    flow.scope.requestPermission.mockReturnValue(permission.promise);
    const pending = flow.call.requestCameraAccess();
    flow.call.handleAppStateChange('background');
    expect(flow.scope.onClose).not.toHaveBeenCalled();
    expect(flow.scope.setReady).toHaveBeenCalledWith(false);
    expect(flow.scope.setTorch).toHaveBeenCalledWith(false);
    permission.finish({ granted: true });
    await pending;
    expect(flow.scope.permissionRoundTrip.current).toBe(true);
    await flow.call.capture();
    expect(flow.scope.camera.current.takePictureAsync).not.toHaveBeenCalled();
    flow.call.handleAppStateChange('active');
    expect(flow.scope.permissionRoundTrip.current).toBe(false);
    expect(flow.scope.foreground.current).toBe(true);
    expect(flow.scope.onClose).not.toHaveBeenCalled();
  });

  it('waits for permission completion when Android resumes before the request promise resolves', async () => {
    const flow = captureFlow();
    const permission = deferred<{ granted: boolean }>();
    flow.scope.requestPermission.mockReturnValue(permission.promise);
    const pending = flow.call.requestCameraAccess();
    flow.call.handleAppStateChange('background');
    flow.call.handleAppStateChange('active');
    await flow.call.capture();
    await flow.call.requestCameraAccess();
    expect(flow.scope.requestPermission).toHaveBeenCalledOnce();
    expect(flow.scope.camera.current.takePictureAsync).not.toHaveBeenCalled();
    permission.finish({ granted: true });
    await pending;
    expect(flow.scope.permissionRoundTrip.current).toBe(false);
    expect(flow.scope.setPermissionPending).toHaveBeenLastCalledWith(false);
    expect(flow.scope.onClose).not.toHaveBeenCalled();
  });

  it('still cancels and cleans real capture when the app backgrounds outside a permission request', async () => {
    const flow = captureFlow();
    const recognition = deferred<{ fields: object }>();
    flow.scope.recognizeFoodLabelPhoto.mockReturnValue(recognition.promise);
    const pending = flow.call.capture();
    await vi.waitFor(() => expect(flow.scope.recognizeFoodLabelPhoto).toHaveBeenCalledOnce());
    flow.call.handleAppStateChange('background');
    recognition.finish({ fields: {} });
    await pending;
    expect(flow.scope.onClose).toHaveBeenCalledOnce();
    expect(flow.scope.setDraft).not.toHaveBeenCalled();
    expect(flow.scope.discardFoodLabelPhoto).toHaveBeenCalledOnce();
    expect(flow.scope.setTorch).toHaveBeenCalledWith(false);
    await flow.call.capture();
    expect(flow.scope.camera.current.takePictureAsync).toHaveBeenCalledOnce();
  });

  it('does not revive a closed session after its permission prompt completes', async () => {
    const flow = captureFlow();
    const permission = deferred<{ granted: boolean }>();
    flow.scope.requestPermission.mockReturnValue(permission.promise);
    const pending = flow.call.requestCameraAccess();
    flow.call.close();
    permission.finish({ granted: true });
    await pending;
    expect(flow.scope.setPermissionPending).toHaveBeenCalledTimes(1);
    expect(flow.scope.setPermissionPending).toHaveBeenCalledWith(true);
    expect(flow.scope.onClose).toHaveBeenCalledOnce();
    await flow.call.capture();
    expect(flow.scope.camera.current.takePictureAsync).not.toHaveBeenCalled();
  });

  it('keeps a settings visit distinct from the permission dialog and retains normal background cancellation', async () => {
    const flow = captureFlow();
    flow.scope.permission.canAskAgain = false;
    await flow.call.requestCameraAccess();
    expect(flow.scope.Linking.openSettings).toHaveBeenCalledOnce();
    expect(flow.scope.permissionRoundTrip.current).toBe(false);
    flow.call.handleAppStateChange('background');
    expect(flow.scope.onClose).toHaveBeenCalledOnce();
  });

  it('cancels an inactive capture and releases busy state when the same session resumes', async () => {
    const flow = captureFlow();
    const recognition = deferred<{ fields: object }>();
    flow.scope.recognizeFoodLabelPhoto.mockReturnValue(recognition.promise);
    const pending = flow.call.capture();
    await vi.waitFor(() => expect(flow.scope.recognizeFoodLabelPhoto).toHaveBeenCalledOnce());
    flow.call.handleAppStateChange('inactive');
    flow.call.handleAppStateChange('active');
    recognition.finish({ fields: {} });
    await pending;
    expect(flow.scope.onClose).not.toHaveBeenCalled();
    expect(flow.scope.setDraft).not.toHaveBeenCalled();
    expect(flow.scope.captureLock.current).toBe(false);
    expect(flow.scope.setBusy).toHaveBeenLastCalledWith(false);
  });
});
