import {TurboModuleRegistry, type TurboModule} from 'react-native';

export interface Spec extends TurboModule {
  readonly exec: (requestJson: string) => Promise<string>;
}

export function getNativeVampnSsh(): Spec | null {
  try {
    return TurboModuleRegistry.get<Spec>('NativeVampnSsh') ?? null;
  } catch {
    return null;
  }
}
