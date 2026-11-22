import AsyncStorage from '@react-native-async-storage/async-storage';

import {defaultConfig, type VampnConfig} from './types';

const STORAGE_KEY = '@vampn/config';

export async function loadConfig(): Promise<VampnConfig> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {...defaultConfig};
  }
  try {
    const parsed = JSON.parse(raw) as Partial<VampnConfig>;
    return {...defaultConfig, ...parsed};
  } catch {
    return {...defaultConfig};
  }
}

export async function saveConfig(config: VampnConfig): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}
