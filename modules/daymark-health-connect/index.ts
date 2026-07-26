// Re-export the native module. On web, it will be resolved to DaymarkHealthConnectModule.web.ts
// and on native platforms to DaymarkHealthConnectModule.ts
export { default } from './src/DaymarkHealthConnectModule';
export * from './src/DaymarkHealthConnect.types';
