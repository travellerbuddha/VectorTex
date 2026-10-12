/**
 * Authored artwork of the site (no stock images, no other brands' assets): the panel's brand mark, the coast scene
 * next to the home search and the postcard drawn for a hotel without photos. All decorative (aria-hidden);
 * server-rendered, so the same input always draws the same picture on the server and in the browser.
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
 * Dusk on the Lycian coast: Taurus ridges, a gulet in the bay and the sun going down in the brand's coral. Drawn for a
 * 6:5 frame and anchored to the bottom, so a wider frame (phones) keeps the horizon and the sun in view. Static on
 * purpose: the frame has a fixed aspect ratio, so the picture keeps its proportions from the first paint on.
 */
export function CoastScene({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 1200 1000" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="coast-sky" x1="0" y1="0" x2="0" y2="640" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0e1b28" />
          <stop offset=".42" stopColor="#1d3447" />
          <stop offset=".7" stopColor="#4a4e62" />
          <stop offset=".88" stopColor="#c6727a" />
          <stop offset="1" stopColor="#f4ab92" />
        </linearGradient>
        <radialGradient id="coast-glow" cx="780" cy="640" r="430" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ff8a7a" stopOpacity=".6" />
          <stop offset=".4" stopColor="#ff5757" stopOpacity=".18" />
          <stop offset="1" stopColor="#ff5757" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="coast-sea" x1="0" y1="640" x2="0" y2="1000" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2a3a4e" />
          <stop offset=".35" stopColor="#152131" />
          <stop offset="1" stopColor="#0b131c" />
        </linearGradient>
      </defs>
      <rect width="1200" height="642" fill="url(#coast-sky)" />
      <rect width="1200" height="642" fill="url(#coast-glow)" />
      <circle cx="780" cy="640" r="92" fill="#ff5757" />
      <circle cx="780" cy="640" r="92" fill="none" stroke="#ffb3a7" strokeOpacity=".45" strokeWidth="8" />
      {/* Far ridge: the Taurus behind the bay, opening where the sun goes down. */}
      <path
        d="M0 520 L60 500 L120 512 L190 470 L260 498 L330 452 L410 492 L480 476 L540 520 L600 566 L650 612 L700 630 L900 632 L950 604 L1010 560 L1070 522 L1130 536 L1200 502 V642 H0 Z"
        fill="#2b3950"
      />
      {/* Near headlands, left and right of the bay. */}
      <path d="M0 560 L70 548 L150 572 L230 566 L310 594 L400 612 L480 626 L560 636 L600 642 H0 Z" fill="#172233" />
      <path d="M1200 566 L1130 580 L1060 602 L1000 622 L960 634 L930 642 H1200 Z" fill="#172233" />
      <rect y="640" width="1200" height="360" fill="url(#coast-sea)" />
      <rect y="638" width="1200" height="3" fill="#ffb39a" fillOpacity=".35" />
      {/* Light on the water under the sun, narrowing towards the shore. */}
      <g stroke="#ff8f84" strokeLinecap="round">
        <path d="M676 656 H884" strokeWidth="6" strokeOpacity=".75" />
        <path d="M700 676 H860" strokeWidth="5" strokeOpacity=".6" />
        <path d="M660 698 H750 M786 698 H900" strokeWidth="4.5" strokeOpacity=".45" />
        <path d="M722 722 H838" strokeWidth="4" strokeOpacity=".38" />
        <path d="M690 750 H760 M800 750 H872" strokeWidth="3.5" strokeOpacity=".3" />
        <path d="M744 782 H816" strokeWidth="3" strokeOpacity=".24" />
        <path d="M762 818 H798" strokeWidth="2.5" strokeOpacity=".18" />
      </g>
      <g stroke="#3d5169" strokeOpacity=".45" strokeWidth="2.5" fill="none" strokeLinecap="round">
        <path d="M80 720 c36 -10 72 -10 108 0 s72 10 108 0" />
        <path d="M150 840 c36 -10 72 -10 108 0 s72 10 108 0" />
        <path d="M940 760 c36 -10 72 -10 108 0 s72 10 108 0" />
        <path d="M1010 900 c36 -10 72 -10 108 0" />
      </g>
      {/* A gulet crossing the bay. */}
      <g fill="#0b131c">
        <path d="M286 668 h118 l-15 15 h-88 Z" />
        <path d="M344 664 V588 l44 76 Z" />
        <path d="M338 664 V604 l-32 60 Z" />
        <rect x="340" y="582" width="4" height="86" />
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
  { sky: '#f6d6b8', sky2: '#fbeadb', sun: '#ff5757', far: '#d0a090', near: '#93646a', sea: '#2c6079', sea2: '#1b4258', ground: '#f1dcc0', build: '#fff8f0', shade: '#ecd9c6', win: '#93646a', palm: '#4f4a3a' },
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
