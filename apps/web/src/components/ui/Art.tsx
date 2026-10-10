/**
 * Authored artwork of the site (no stock images, no other brands' assets): the brand mark, the coast scene behind the
 * home search and the postcard drawn for a hotel without photos. All decorative (aria-hidden); server-rendered, so the
 * same input always draws the same picture on the server and in the browser.
 */

/** A holiday voucher: terracotta ticket with side notches, the sun setting into the sea. */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M7 4h18a3 3 0 0 1 3 3v6a3 3 0 0 0 0 6v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6a3 3 0 0 0 0-6V7a3 3 0 0 1 3-3Z" fill="#b5482a" />
      <path d="M10 17.5a6 6 0 0 1 12 0Z" fill="#f4bb4a" />
      <path d="M8 21.2c1.33-.9 2.67-.9 4 0s2.67.9 4 0 2.67-.9 4 0 2.67.9 4 0" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M11 24.6c1.25-.8 2.5-.8 3.75 0s2.5.8 3.75 0 2.5-.8 3.75 0" fill="none" stroke="#fff" strokeOpacity=".7" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Evening on the Lycian coast: Taurus ridges, a sailing boat, the sun going down into the bay. Anchored to the bottom so
 * the horizon stays in view on short and narrow screens; the sea at the bottom matches the hero's own colour.
 */
export function CoastScene({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 1600 560" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="coast-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#062a3a" />
          <stop offset=".55" stopColor="#0b4f6c" />
          <stop offset="1" stopColor="#2f7d8c" />
        </linearGradient>
        <radialGradient id="coast-glow" cx="1000" cy="400" r="420" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f4bb4a" stopOpacity=".55" />
          <stop offset=".35" stopColor="#e9895a" stopOpacity=".22" />
          <stop offset="1" stopColor="#e9895a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="coast-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0d5a78" />
          <stop offset=".45" stopColor="#083a50" />
          <stop offset="1" stopColor="#062a3a" />
        </linearGradient>
      </defs>
      <rect width="1600" height="560" fill="url(#coast-sky)" />
      <rect width="1600" height="560" fill="url(#coast-glow)" />
      <g className="coast-sun">
        <circle cx="1000" cy="402" r="74" fill="#f4bb4a" />
        <circle cx="1000" cy="402" r="74" fill="none" stroke="#fbd98c" strokeOpacity=".5" strokeWidth="10" />
      </g>
      {/* Far ridge: the Taurus behind the bay, paler with distance. */}
      <path
        d="M0 352 L70 318 L128 334 L196 286 L262 312 L330 262 L402 300 L468 276 L540 318 L610 298 L668 330 L742 304 L812 338 L880 352 L1130 360 L1190 334 L1250 346 L1318 300 L1384 318 L1446 282 L1520 312 L1600 296 V404 H0 Z"
        fill="#11607f"
        fillOpacity=".85"
      />
      {/* Near headlands, left and right of the bay. */}
      <path d="M0 330 L54 312 L118 340 L170 322 L236 356 L300 346 L372 372 L452 380 L540 396 L612 404 H0 Z" fill="#0a3a50" />
      <path d="M1600 338 L1540 350 L1488 334 L1430 362 L1372 372 L1300 388 L1220 404 H1600 Z" fill="#0a3a50" />
      <rect y="402" width="1600" height="158" fill="url(#coast-sea)" />
      {/* Light on the water under the sun, narrowing towards the shore. */}
      <g className="coast-glitter" stroke="#f4bb4a" strokeLinecap="round">
        <path d="M930 414 H1070" strokeWidth="5" strokeOpacity=".75" />
        <path d="M948 428 H1046" strokeWidth="4" strokeOpacity=".6" />
        <path d="M904 442 H968 M992 442 H1094" strokeWidth="3.5" strokeOpacity=".45" />
        <path d="M962 458 H1036" strokeWidth="3" strokeOpacity=".4" />
        <path d="M928 476 H974 M1010 476 H1068" strokeWidth="2.5" strokeOpacity=".3" />
        <path d="M976 496 H1024" strokeWidth="2" strokeOpacity=".25" />
      </g>
      <g stroke="#3d8fa6" strokeOpacity=".35" strokeWidth="2" fill="none" strokeLinecap="round">
        <path d="M120 446 c30-8 60-8 90 0 s60 8 90 0" />
        <path d="M420 486 c30-8 60-8 90 0 s60 8 90 0" />
        <path d="M1280 456 c30-8 60-8 90 0 s60 8 90 0" />
        <path d="M1380 512 c30-8 60-8 90 0" />
      </g>
      {/* A gulet crossing the bay. */}
      <g fill="#062a3a">
        <path d="M770 398 h86 l-12 12 h-64 Z" />
        <path d="M806 396 V330 l32 64 Z" />
        <path d="M802 396 V342 l-22 52 Z" />
        <rect x="804" y="326" width="3" height="72" />
      </g>
    </svg>
  );
}

/** FNV-1a then mulberry32: a stable random sequence per hotel. */
function sequence(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETTES = [
  // Noon: pale sky, deep bay.
  { sky: '#cfe8ee', sky2: '#e8f4f7', sun: '#f4bb4a', far: '#8dbccb', near: '#3a87a2', sea: '#0b4f6c', sea2: '#0a3a50', ground: '#efe4cf', build: '#ffffff', shade: '#d9e6ea', win: '#0b4f6c', palm: '#245f52' },
  // Late afternoon: warm sky, terracotta sun.
  { sky: '#f6d6b8', sky2: '#fbeadb', sun: '#d9653d', far: '#d0a090', near: '#93646a', sea: '#2c6079', sea2: '#1b4258', ground: '#f1dcc0', build: '#fff8f0', shade: '#ecd9c6', win: '#93646a', palm: '#4f4a3a' },
  // Evening: deep teal sky, lit windows.
  { sky: '#0b4f6c', sky2: '#2f7d8c', sun: '#f4bb4a', far: '#15607e', near: '#083a50', sea: '#062a3a', sea2: '#041f2b', ground: '#0a3a50', build: '#e5eff2', shade: '#b8cdd4', win: '#f4bb4a', palm: '#041f2b' },
  // Lagoon: turquoise shallows.
  { sky: '#dcf0ef', sky2: '#f2faf9', sun: '#f2a541', far: '#9ccac5', near: '#4f9a92', sea: '#1d7f8a', sea2: '#0e5f6a', ground: '#f3e8d2', build: '#ffffff', shade: '#dbe9e6', win: '#1d7f8a', palm: '#2e6b4a' },
] as const;

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Ridge line across the picture: points between `top` and `bottom`, closed down to the horizon. */
function ridge(next: () => number, points: number, top: number, bottom: number, horizon: number): string {
  const step = 400 / (points - 1);
  const ys = Array.from({ length: points }, () => r1(top + next() * (bottom - top)));
  return `M0 ${horizon} L0 ${ys[0]} ${ys.map((y, i) => `L${r1(i * step)} ${y}`).join(' ')} L400 ${horizon} Z`;
}

/**
 * A postcard for a hotel without photos: the same hotel always gets the same card (palette, ridges, sun, building).
 * Flat fills only, so several cards on one page need no shared ids.
 */
export function HotelArt({ seed, className }: { seed: string; className?: string }) {
  const next = sequence(seed);
  const p = PALETTES[Math.floor(next() * PALETTES.length)]!;
  const horizon = 168;
  const sunX = r1(70 + next() * 260);
  const sunY = r1(78 + next() * 40);
  const sunR = r1(17 + next() * 12);
  const buildLeft = next() < 0.5;
  const bw = r1(112 + next() * 46);
  const bh = r1(62 + next() * 30);
  const bx = r1(buildLeft ? 30 + next() * 70 : 400 - 30 - bw - next() * 70);
  const base = 214;
  const floors = Math.max(3, Math.floor(bh / 17));
  const cols = Math.max(4, Math.floor(bw / 20));
  const palmX = r1(buildLeft ? 300 + next() * 60 : 40 + next() * 60);
  const lean = buildLeft ? -1 : 1;
  const windows: string[] = [];
  for (let f = 0; f < floors - 1; f++) {
    for (let c = 0; c < cols; c++) {
      const wx = r1(bx + 9 + c * ((bw - 18) / cols));
      const wy = r1(base - bh + 12 + f * ((bh - 16) / floors));
      windows.push(`M${wx} ${wy}h${r1((bw - 18) / cols - 6)}v6h-${r1((bw - 18) / cols - 6)}Z`);
    }
  }
  return (
    <svg className={className} viewBox="0 0 400 250" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <rect width="400" height="250" fill={p.sky} />
      <rect y="0" width="400" height="70" fill={p.sky2} opacity=".6" />
      <circle cx={sunX} cy={sunY} r={sunR} fill={p.sun} />
      <path d={ridge(next, 8, 92, 136, horizon)} fill={p.far} />
      <path d={ridge(next, 6, 128, 158, horizon)} fill={p.near} />
      <rect y={horizon} width="400" height="50" fill={p.sea} />
      <rect y={horizon + 26} width="400" height="24" fill={p.sea2} />
      <path d={`M${r1(sunX - 34)} ${horizon + 9}h68M${r1(sunX - 20)} ${horizon + 18}h40`} stroke={p.sun} strokeOpacity=".7" strokeWidth="3" strokeLinecap="round" />
      <rect y="206" width="400" height="44" fill={p.ground} />
      {/* The hotel: a white block with balconies, its shaded side and lit windows. */}
      <rect x={bx} y={r1(base - bh)} width={bw} height={bh} fill={p.build} />
      <rect x={r1(bx + bw - 14)} y={r1(base - bh)} width="14" height={bh} fill={p.shade} />
      <rect x={r1(bx - 4)} y={r1(base - bh - 5)} width={r1(bw + 8)} height="6" fill={p.shade} />
      <path d={windows.join('')} fill={p.win} fillOpacity=".85" />
      {/* A palm on the shore. */}
      <path d={`M${palmX} 222 q${3 * lean} -30 ${12 * lean} -58`} stroke={p.palm} strokeWidth="5" fill="none" strokeLinecap="round" />
      <g fill={p.palm} transform={`translate(${r1(palmX + 12 * lean)} 164)`}>
        <path d="M0 0 q-22 -10 -38 6 q18 -4 38 -6Z" />
        <path d="M0 0 q22 -10 38 6 q-18 -4 -38 -6Z" />
        <path d="M0 0 q-10 -20 -30 -22 q16 6 30 22Z" />
        <path d="M0 0 q10 -20 30 -22 q-16 6 -30 22Z" />
        <path d="M0 0 q-2 -22 6 -30 q-4 14 -6 30Z" />
      </g>
    </svg>
  );
}
