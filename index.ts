import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';

import App from './App';
import {
  GLUCOSE_DISPLAY_HEADLESS_TASK,
  runGlucoseDisplayForegroundSync,
} from './src/data/glucoseDisplay/glucoseDisplayCoordinator';
import './src/data/background/libreSyncTask';

AppRegistry.registerHeadlessTask(GLUCOSE_DISPLAY_HEADLESS_TASK, () =>
  runGlucoseDisplayForegroundSync,
);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
