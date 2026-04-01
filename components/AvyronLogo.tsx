import React from 'react';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';

interface AvyronLogoProps {
  size?: number;
}

export default function AvyronLogo({ size = 40 }: AvyronLogoProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="avyronGrad" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#7C3AED" stopOpacity="1" />
          <Stop offset="0.5" stopColor="#6D28D9" stopOpacity="1" />
          <Stop offset="1" stopColor="#3B82F6" stopOpacity="1" />
        </LinearGradient>
      </Defs>
      {/* Left arm of the A */}
      <Path
        d="M 4,90 L 42,5 L 56,5 L 34,50 L 27,90 Z"
        fill="url(#avyronGrad)"
      />
      {/* Right arm of the A */}
      <Path
        d="M 96,90 L 58,5 L 44,5 L 66,50 L 73,90 Z"
        fill="url(#avyronGrad)"
      />
    </Svg>
  );
}
