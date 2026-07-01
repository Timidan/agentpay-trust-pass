import { useEffect, useState } from "react";
import "./living-field.css";

/**
 * App-wide ambient "living field": real molten-metal footage washed to the
 * signal-box palette, sitting behind every screen. Theme-aware via the `.dark`
 * class on <html>; stronger on the /agents page via `.route-agents`. Honours
 * prefers-reduced-motion by showing a static poster frame instead of the video.
 */
export function LivingField() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener?.("change", sync);
    return () => query.removeEventListener?.("change", sync);
  }, []);

  return (
    <div className="living-field" aria-hidden="true">
      {reducedMotion ? (
        <img className="lf-media" src="/media/liquid-metal-poster.jpg" alt="" />
      ) : (
        <video
          className="lf-media"
          src="/media/liquid-metal.mp4"
          poster="/media/liquid-metal-poster.jpg"
          autoPlay
          muted
          loop
          playsInline
        />
      )}
      <div className="lf-tint" />
      <div className="lf-vign" />
    </div>
  );
}

export default LivingField;
