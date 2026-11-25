import Svg, {Circle, Ellipse, Path} from 'react-native-svg';

export type IconName = 'shield' | 'key' | 'bars' | 'users' | 'sliders' | 'globe' | 'refresh' | 'arrow' | 'zap';

type Props = {
  name: IconName;
  size?: number;
  color: string;
  /** Заливка кружков у значка «настройки»: цвет фона, на котором он стоит. */
  knob?: string;
};

/** Линейные значки из макета (сетка 24, линия 1.6). */
export function Icon({name, size = 20, color, knob = 'none'}: Props) {
  const line = {
    stroke: color,
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" pointerEvents="none">
      {name === 'shield' ? (
        <>
          <Path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z" {...line} />
          <Path d="m8 12 3 3 5-6" {...line} />
        </>
      ) : null}
      {name === 'key' ? (
        <>
          <Circle cx={8} cy={9} r={5} {...line} />
          <Path d="m12 13 8 8m-4-4 3-3m-6 0 3-3" {...line} />
        </>
      ) : null}
      {name === 'bars' ? <Path d="M4 20V10m8 10V4m8 16v-7" {...line} /> : null}
      {name === 'users' ? (
        <>
          <Circle cx={9} cy={7} r={3} {...line} />
          <Path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m3 11v-3a6 6 0 0 0-2-4" {...line} />
        </>
      ) : null}
      {name === 'sliders' ? (
        <>
          <Path d="M4 7h16M4 17h16" {...line} />
          <Circle cx={9} cy={7} r={2} {...line} fill={knob} />
          <Circle cx={15} cy={17} r={2} {...line} fill={knob} />
        </>
      ) : null}
      {name === 'globe' ? (
        <>
          <Circle cx={12} cy={12} r={9} {...line} />
          <Ellipse cx={12} cy={12} rx={4} ry={9} {...line} />
          <Path d="M3 12h18" {...line} />
        </>
      ) : null}
      {name === 'refresh' ? <Path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5" {...line} /> : null}
      {name === 'arrow' ? <Path d="M5 12h14m-5-5 5 5-5 5" {...line} /> : null}
      {name === 'zap' ? <Path d="m13 2-9 12h7l-1 8 10-12h-7z" {...line} /> : null}
    </Svg>
  );
}
