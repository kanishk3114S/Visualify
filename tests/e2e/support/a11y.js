/**
 * Waits until every FINITE animation and transition on the page (entrance
 * fades, view transitions, theme colour transitions) has finished, so axe
 * measures colour contrast on the settled UI rather than a frame captured
 * mid-fade. Infinite decorative loops (float, marquee, shimmer, calm pulse)
 * never finish and are ignored; they don't change text colour or opacity.
 *
 * Without this, slower CI runners intermittently report contrast "failures"
 * for elements that are simply part-way through an opacity animation (the
 * reported colours are the real tokens blended towards the background).
 */
export async function settleAnimations(page, { timeoutMs = 5_000 } = {}) {
  await page.waitForFunction(
    () => {
      const running = document.getAnimations().filter((animation) => {
        if (animation.playState !== "running" && animation.playState !== "pending") return false;
        const endTime = animation.effect?.getComputedTiming?.().endTime;
        return Number.isFinite(endTime);
      });
      // Require two consecutive quiet checks so an animation that starts on the
      // next frame (e.g. a reveal triggered by layout) is not missed.
      const quiet = running.length === 0;
      window.__e2eQuietFrames = quiet ? (window.__e2eQuietFrames ?? 0) + 1 : 0;
      return window.__e2eQuietFrames >= 2;
    },
    null,
    { timeout: timeoutMs, polling: "raf" }
  );
  await page.evaluate(() => {
    delete window.__e2eQuietFrames;
  });
}
