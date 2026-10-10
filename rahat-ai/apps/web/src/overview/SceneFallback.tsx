/** Layered SVG scene used when WebGL is unavailable or the 3D scene fails. Pure CSS motion. */
export default function SceneFallback() {
  const tower = (x: number, w: number, h: number, c: string) =>
    <path key={x} d={`M${x} 520 L${x + w * 0.1} ${520 - h} L${x + w * 0.9} ${520 - h} L${x + w} 520Z`} fill={c} />;
  const tree = (x: number, s: number) => <g key={x} transform={`translate(${x} 520) scale(${s})`}>
    <path d="M-14 0 C-8 -90 -6 -150 -4 -200 L4 -200 C6 -150 8 -90 14 0Z" fill="#6b5a4a" />
    {[[-70, -230, 70], [0, -270, 86], [72, -228, 66], [-24, -206, 60]].map(([cx, cy, r], i) =>
      <ellipse key={i} cx={cx} cy={cy} rx={r} ry={r * 0.52} fill={i % 2 ? "#4f9a52" : "#3e8a50"} />)}
  </g>;
  return <div className="ov-fallback" role="img"
    aria-label="Illustration of a green future city street with a cyclist. 3D view unavailable, showing a 2D version.">
    <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="fb-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3f88bd" /><stop offset=".55" stopColor="#9ccfd9" /><stop offset="1" stopColor="#e6ecd9" />
        </linearGradient>
        <radialGradient id="fb-sun"><stop offset="0" stopColor="#fff4d6" stopOpacity=".95" /><stop offset="1" stopColor="#fff4d6" stopOpacity="0" /></radialGradient>
        <linearGradient id="fb-road" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3a4246" /><stop offset="1" stopColor="#23292c" /></linearGradient>
      </defs>
      <rect width="1600" height="900" fill="url(#fb-sky)" />
      <circle cx="560" cy="330" r="260" fill="url(#fb-sun)" />
      <g className="fb-far" opacity=".55" transform="translate(0 -120)">
        {[[80, 70, 220], [190, 60, 300], [300, 80, 190], [980, 70, 260], [1100, 60, 340], [1230, 90, 210], [1390, 70, 280]]
          .map(([x, w, h], i) => tower(x, w, h, i % 2 ? "#8fb4b8" : "#a3c4c0"))}
      </g>
      <path d="M0 520 C300 470 520 500 800 480 C1100 460 1300 500 1600 470 L1600 900 L0 900Z" fill="#5da05a" />
      <g className="fb-mid">{tree(170, 1.1)}{tree(430, 0.8)}{tree(1210, 1.2)}{tree(1470, 0.9)}</g>
      <path d="M0 900 L0 640 L700 520 L900 520 L1600 640 L1600 900Z" fill="#6aa857" />
      <path d="M560 900 L740 520 L860 520 L1130 900Z" fill="url(#fb-road)" />
      <path className="fb-dash" d="M800 900 L800 520" stroke="#e9e3c9" strokeWidth="6" strokeDasharray="40 60" opacity=".75" />
      <path d="M1180 900 L930 520 L990 520 L1440 900Z" fill="#2c98a4" opacity=".75" />
      <g transform="translate(790 760)">
        <ellipse cx="0" cy="62" rx="120" ry="14" fill="#000" opacity=".28" />
        {[-70, 70].map(x => <g key={x} transform={`translate(${x} 20)`}>
          <circle r="44" fill="none" stroke="#14181a" strokeWidth="9" />
          <g className="fb-wheel"><path d="M-40 0H40M0 -40V40M-28 -28L28 28M-28 28L28 -28" stroke="#aab6bb" strokeWidth="2" /></g>
        </g>)}
        <path d="M-70 20 L-20 -30 L40 -30 L70 20 M-20 -30 L-6 20 L-70 20" stroke="#27b58a" strokeWidth="7" fill="none" strokeLinejoin="round" />
        <g className="fb-body">
          <path d="M-8 -34 C-6 -90 6 -110 26 -118 L40 -96 C24 -86 20 -64 22 -34Z" fill="#eef2ee" />
          <rect x="-34" y="-104" width="30" height="48" rx="10" fill="#2b3a40" />
          <circle cx="36" cy="-134" r="15" fill="#c68e6a" />
          <path d="M20 -140 C22 -158 52 -158 54 -140Z" fill="#f4f7f4" />
          <path d="M26 -100 L56 -58" stroke="#c68e6a" strokeWidth="8" strokeLinecap="round" />
        </g>
      </g>
    </svg>
  </div>;
}
