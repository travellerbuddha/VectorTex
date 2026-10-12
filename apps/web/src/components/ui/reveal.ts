/**
 * One-time scroll reveals for discovery sections. CSS keeps every element visible; only elements still below the
 * viewport are prepared (paused at their first frame) and play once just before they enter. Mark leaf groups with
 * data-reveal="rise|lift|slide|media|fade|stub" and optionally data-reveal-delay / data-reveal-duration (ms).
 */
const FROM: Record<string, Keyframe> = {
  // Text groups move only (no opacity), so every frame keeps full contrast.
  rise: { transform: 'translateY(24px)' },
  lift: { transform: 'translateY(40px)' },
  slide: { transform: 'translateX(24px)' },
  fade: { transform: 'translateY(12px)' },
  // Pictures may ease in from a lighter state.
  media: { opacity: 0.4, transform: 'scale(1.05)' },
  // The footer wordmark rises out of its clipped box; the clip hides it, so it stays opaque.
  stub: { transform: 'translateY(32%)' },
};

export function installReveals(root: ParentNode = document): () => void {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Map<HTMLElement | SVGElement, Animation>();
  const elements = [...root.querySelectorAll<HTMLElement | SVGElement>('[data-reveal]')];
  const finish = (element: HTMLElement | SVGElement) => {
    element.dataset.revealPlayed = 'true';
    animations.get(element)?.cancel();
    animations.delete(element);
  };
  const observer =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              const element = entry.target as HTMLElement | SVGElement;
              observer?.unobserve(element);
              element.dataset.revealPlayed = 'true';
              if (reduced.matches || document.visibilityState === 'hidden' || entry.boundingClientRect.bottom <= 0) finish(element);
              else animations.get(element)?.play();
            }
          },
          { threshold: 0, rootMargin: '0px 0px 96px 0px' },
        )
      : undefined;
  const stop = () => {
    observer?.disconnect();
    elements.forEach(finish);
  };
  const onPreference = () => {
    if (reduced.matches) stop();
  };
  reduced.addEventListener('change', onPreference);
  for (const element of elements) {
    if (element.dataset.revealPlayed === 'true') continue;
    const rect = element.getBoundingClientRect();
    // Never hide content that is already on screen (first paint or a restored scroll position), nor content inside the
    // observer's 96px lead, which would start fading in at load without any scroll.
    if (reduced.matches || !observer || !element.animate || rect.top < innerHeight + 96 || document.visibilityState === 'hidden') {
      finish(element);
      continue;
    }
    const from = FROM[element.dataset.reveal ?? ''] ?? FROM.rise!;
    const to: Keyframe = 'opacity' in from ? { opacity: 1, transform: 'none' } : { transform: 'none' };
    const animation = element.animate([from, to], {
      duration: Number(element.dataset.revealDuration) || 600,
      delay: Math.min(Number(element.dataset.revealDelay) || 0, 240),
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'backwards',
    });
    animation.pause();
    animation.onfinish = () => finish(element);
    animations.set(element, animation);
    observer.observe(element);
  }
  // Unmount (or React's dev double-mount): cancel owned animations so everything is visible, but do not mark unplayed
  // groups as played, so a remount can still reveal them once.
  return () => {
    observer?.disconnect();
    for (const [element, animation] of animations) {
      animation.cancel();
      animations.delete(element);
    }
    reduced.removeEventListener('change', onPreference);
  };
}
