/**
 * @format
 */

import {AppRegistry, NativeModules} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

const inExpoGo = NativeModules.ExponentConstants?.appOwnership === 'expo';

if (inExpoGo) {
  // Loaded only in Expo Go. The bare Android and iOS apps do not ship Expo's
  // native runtime, so requiring it there would crash on startup.
  require('expo').registerRootComponent(App);
} else {
  AppRegistry.registerComponent(appName, () => App);
  AppRegistry.registerComponent('main', () => App);
}
