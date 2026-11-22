import {TurboModuleRegistry, type TurboModule} from 'react-native';

export interface Spec extends TurboModule {
  readonly exec: (requestJson: string) => Promise<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativeVampnSsh');
