import {useState} from 'react';
import {StatusBar, StyleSheet, View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {HomeScreen} from './src/screens/HomeScreen';
import {SettingsScreen} from './src/screens/SettingsScreen';

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <View style={styles.root}>
        {settingsOpen ? (
          <SettingsScreen onClose={() => setSettingsOpen(false)} />
        ) : (
          <HomeScreen onOpenSettings={() => setSettingsOpen(true)} />
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0e0d12',
  },
});

export default App;
