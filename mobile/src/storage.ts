import AsyncStorage from '@react-native-async-storage/async-storage';

import {defaultConfig, type VampnConfig} from './types';

const STORAGE_KEY = '@vampn/config';
const memory = new Map<string, string>();

async function readRaw(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(STORAGE_KEY);
  } catch {
    return memory.get(STORAGE_KEY) ?? null;
  }
}

async function writeRaw(value: string): Promise<void> {
  memory.set(STORAGE_KEY, value);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Expo Go can boot before the native storage module is usable.
  }
}

export async function loadConfig(): Promise<VampnConfig> {
  const raw = await readRaw();
  if (!raw) {
    return {...defaultConfig};
  }
  try {
    const parsed = JSON.parse(raw) as Partial<VampnConfig>;
    const config = {...defaultConfig, ...parsed};
    if (config.actionMode !== 'force') {
      config.actionMode = 'rotate';
    }
    return config;
  } catch {
    return {...defaultConfig};
  }
}

export async function saveConfig(config: VampnConfig): Promise<void> {
  await writeRaw(JSON.stringify(config));
}
