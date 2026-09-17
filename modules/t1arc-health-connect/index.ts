// Re-export the native module. On web, it will be resolved to T1ArcHealthConnectModule.web.ts
// and on native platforms to T1ArcHealthConnectModule.ts
export { default } from './src/T1ArcHealthConnectModule';
export * from './src/T1ArcHealthConnect.types';
