# Lifelike UI animation — practitioners who reshape real image/video into product-native motion

> **What this is.** A research dossier of people and studios who have developed a real
> *skill* for UI/web animation that is (1) lifelike/cinematic, (2) distinctive, and
> (3) takes **real** photographic or video assets (footage, photos, scans, b-roll) and
> reshapes them so they feel native to the specific product/brand.
>
> **How it was built.** A 6-angle web sweep surfaced **72 verified practitioners**; the
> top 12 were then independently deep-verified with watchable clips. Every link came from
> live web search, not from memory.
>
> **Why it's here.** Casper / Trust Signal is a token due-diligence agent that renders
> verdicts (CLEAR / CAUTION / DANGER). Motion has to read as *earned by the data*, not
> slick-deceptive. The closing section maps these techniques to that constraint, and a
> working prototype lives in the app (see [Prototype](#prototype-in-this-repo)).

---

## Start here (the 7 most on-target)

- **[Aristide Benoist](https://aristidebenoist.com/)** — hand-written WebGL/GLSL feeding real film stills/footage through shaders ([House of Gucci](https://www.awwwards.com/sites/welcome-to-the-house-of-gucci), [Mank](https://www.awwwards.com/sites/mank-the-unmaking)). The footage is the hero; the shader is connective tissue.
- **[Codrops / Tympanus](https://tympanus.net/codrops/)** (Manoela Ilic & Mary Lou) — the publication that taught this whole field; free production-ready tutorials.
- **[Yuri Artiukh / akella](https://www.youtube.com/@akella_/streams)** — best public educator; turns images already in the DOM into shader-warped motion.
- **[mount inc.](https://mount.jp/)** — frame-accurate "touchable video": real footage scrubbed like a physical object.
- **[Stefan Vitasović](https://stefanvitasovic.dev/)** (14islands) — real video as a programmable shader texture; one shared "look" unifies every clip.
- **[basement.studio](https://basement.studio/showcase/vercel)** — generative + real media sculpted into WebGL for product launches (Vercel Ship).
- **[David Sheldrick](https://www.instagram.com/davidsheldrick/)** — reshapes real archival film/photos so AI inherits the original grain/colour; brand-native, not "AI look".

---

## Deep-verified shortlist (with watchable clips)

People who bend real assets into native, paced, trustworthy interfaces — each confirmed real.

**Aristide Benoist — top-tier.** Vanilla WebGL/GLSL (no framework) feeding real film stills & fashion photos into custom fragment shaders for displacement/warp reveal-masks.
- Watch: [House of Gucci (Awwwards SOTD)](https://www.awwwards.com/sites/welcome-to-the-house-of-gucci) · [Mank "the Unmaking" / Netflix](https://www.awwwards.com/sites/mank-the-unmaking) · [Codrops: distorted image-mask GLSL](https://tympanus.net/codrops/2019/11/26/creating-a-distorted-mask-effect-on-an-image-with-babylon-js-and-glsl/)
- Steal: animate displacement *down to zero* as each DD check passes, then freeze to a flat verdict card — motion = "verifying," crisp still = "confirmed fact."

**mount inc. — top-tier.** Frame-accurate "touchable video": real footage re-encoded for instant random-access so users scrub it like a physical object, synced to WebGL overlays.
- Watch: [KAI Design Dept (live)](https://www.kai-group.com/global/design/) · [Codrops breakdown](https://tympanus.net/codrops/2025/11/20/behind-the-kai-design-dept-experience-webgl-line-blur-video-scrubbing-and-3d-animation/) · [Awwwards profile](https://www.awwwards.com/mountinc/submissions)
- Steal: drive `currentTime` from a drag value so users scrub real evidence like a dial; bind an SVG/WebGL annotation overlay to the same 0–1 timeline.

**Stefan Vitasović — top-tier.** Real HD footage on Three.js planes through *one* shared shader (LED grid + grain + displacement) so disparate clips read as a single brand system.
- Watch: [Codrops case study](https://tympanus.net/codrops/2025/03/05/case-study-stefan-vitasovic-portfolio-2025/) · [live site](https://stefanvitasovic.dev/) · [Awwwards SOTD](https://www.awwwards.com/sites/stefan-vitasovic-portfolio25)
- Steal: composite ONE shared shader (grain + grid + verdict-colour tint) over every asset; noise-wipe transitions double as a "scanning" feel that hides load latency.

**basement.studio — top-tier.** GPU shaders + handcrafted 3D shipped as performant production sites; real product photos cast distance-aware soft shadows so they feel physically pinned. _(Honest caveat: the Vercel Ship hero is mostly generative/handcrafted, not real footage reshaped.)_
- Watch: [Daylight Computer (live)](https://daylightcomputer.com/) · [Ship 2025 shader playground](https://ship-25-explorations.vercel.app/) · [Shipping Ship case study](https://basement.studio/post/shipping-ship-behind-the-particle-shader-effect-for-vercels-conf)
- Steal: one depth-aware soft-shadow shader, bind "elevation" to trust score — CLEAR grounded, CAUTION floating, DANGER detached.

**Yuri Artiukh (akella) — top-tier.** The HTML↔WebGL seam: takes images already in the DOM and adds scroll-reactive distortion/pixelation/reveal without rebuilding the page.
- Watch: [On-Scroll Revealing WebGL Images (live)](https://tympanus.net/Development/RevealingWebGLImages) · [WebGL Image Transitions (live)](http://tympanus.net/Development/webGLImageTransitions/) · [Codrops case + source](https://tympanus.net/codrops/2024/02/07/on-scroll-revealing-webgl-image-explorations/)
- Steal: shader-as-state-machine — one `uProgress` + `uVerdict` mode → CLEAR (clean resolve) / CAUTION (residual dither) / DANGER (glitch) off the same plane. **(This is the core idea the prototype implements.)**

**Thibault Guignand — rising.** Single-uniform "melting" real-video transitions: one GSAP-tweened scalar drives block-reveal + noise displacement + chromatic aberration *and* DOM clip-path/text wipes (OGL).
- Watch: [live portfolio](https://www.thibaultguignand.com/) · [Codrops: From Shader Uniforms to Clip-Path Wipes](https://tympanus.net/codrops/2026/05/06/from-shader-uniforms-to-clip-path-wipes-how-gsap-drives-my-portfolio/) · [Awwwards HM](https://www.awwwards.com/sites/thibault-guignand-portfolio)
- Steal: one scalar (0 = DANGER → 1 = CLEAR) fans out to shader *and* DOM — transitions can't desync, distortion intensity literally encodes risk. **(Also implemented in the prototype.)**

**Jean Mazouni — top-tier.** Makes real photo/video physically manipulable: draggable reveal-masks over footage, and a scroll-driven 35mm film roll mounting real negatives on a physics-driven 3D Canon F1.
- Watch: [35mm (live, Awwwards SOTD)](https://35mm-one.vercel.app/) · [Awwwards case](https://www.awwwards.com/sites/35mm) · [Codrops Developer Spotlight](https://tympanus.net/codrops/2025/03/20/developer-spotlight-jean-mazouni/)
- Steal: verdict as top layer; let users *drag the mask aside* to expose raw on-chain evidence — trust because nothing is hidden.

**Lusion (Edan Kwan) — legend.** Real-time WebGL fusing pre-rendered cinematic video with real-world capture (photogrammetry, LiDAR, GPR, CT) + GPU particles.
- Watch: [Lusion v3 (live)](https://lusion.co/) · [Of the Oak field guide (live)](https://oftheoak.co.uk/) · [Awwwards case (Animation 10.0)](https://www.awwwards.com/sites/lusion-v3)
- Steal: render the token's "risk story" offline to video, lock a lightweight real-time layer to the same camera; use the "field guide" structure to walk users through a token's risk relationships.

**David Sheldrick — top-tier.** Reshapes real archival assets (35,000+ restored 35mm slides) so AI inherits the original's grain/colour/lens character; invisible compositing of live footage + AI.
- Watch: [Sora Showcase (OpenAI "Sora Selects")](https://www.youtube.com/watch?v=S_ZcwhTXm1c) · [OpenAI × Sheldrick (TikTok)](https://www.tiktok.com/@openai/video/7411600073693383966) · [Stella McCartney SS25](https://www.stellamccartney.com/gb/en/Summer-2025-campaign.html)
- Steal: anchor + reshape — keep verdict/raw facts pristine; build ONE reusable "grade" (easing, grain, colour temp per tier) every state inherits so DANGER feels native, not a slapped-on toast.

**Bilawal Sidhu — top-tier.** Reality capture → web motion: films a real place, trains a Gaussian splat, flies an impossible virtual camera through it; composites CGI into scans with matched lighting.
- Watch: [3D Gaussian Splatting explained](https://www.youtube.com/watch?v=sQcrZHvrEnU) · [bilawal.ai](https://bilawal.ai/) · [real scans + CGI in Octane (X)](https://x.com/bilawalsidhu/status/2013677348474769615)
- Steal: scroll-lock one continuous camera move over real captured evidence, wide/ambiguous → pinned on the verdict badge, colour-grading the field as it arrives.

**Active Theory — legend.** Streams live video into a WebGL scene as a real-time texture, then samples per-frame colour to re-light the whole 3D world — at 750k+ concurrent (Hydra engine).
- Watch: [Mux × Active Theory case study (Secret Sky)](https://www.mux.com/case-studies/active-theory) · [Webby entry](https://www.webbyawards.com/crafted-with-code/secret-sky-2020/) · [studio reel (X)](https://x.com/active_theory/status/1260248556042022915)
- Steal: derive one state colour from your live risk feed → global ambient uniform / CSS var; the verdict screen is *bathed* in the state.

**Benji Taylor (Family) — legend.** Continuity-preserving motion: never cuts between screens — every transition is a shared-element morph; "Wallet Wrapped" auto-generates from real wallet data.
- Watch: [60fps.design — Family shots](https://60fps.design/apps/family) · [Wallet Wrapped case study](https://www.behance.net/gallery/181342201/Family-Wallet-Wrapped) · [benji.org/family-values](https://benji.org/family-values)
- Steal: verdict reveal = shared-element morph (tapped token row expands into the panel, no route change); CTA morphs "Analyzing" → verdict; reserve the strongest motion/haptic/colour for DANGER.

---

## Apply to a trust/credibility product

- **Severity earned, not decorative** (Benoist warp-to-resolve + Sheldrick anchor-and-reshape): the verdict reads as a product of the data; calibrate severity instead of defaulting to alarm.
- **One number drives everything** (Guignand + akella): a single verdict scalar 0→1 fans out to shader *and* DOM; one plane, three branches; intensity = risk.
- **Verdict ambient before it's read** (Active Theory + basement): global glow from the live feed; card elevation encodes confidence — trust *felt*, not just labeled.
- **Evidence grippable so nothing's hidden** (mount + Mazouni): scrub on-chain history like a dial; drag the verdict mask aside to the raw contract/holder data.
- **Cinematic reveal, live numbers** (Lusion + Sidhu): baked-video + synced real-time layer / scroll-locked impossible camera, colour-graded on arrival.
- **Never cut; morph** (Benji Taylor + Vitasović): token row morphs into the verdict panel; unify every heterogeneous asset under one shared shader so the report reads as one trustworthy system.

---

## Prototype in this repo

A working implementation of the **"one scalar → CLEAR / CAUTION / DANGER"** verdict reveal —
combining the akella shader-plane idea, Guignand's single-uniform principle, and Family's
shared-element settle. Built in the existing stack (React + Vite + Three.js + GSAP), with
honest fallbacks (ships the final readable state under `prefers-reduced-motion` or without WebGL).

- Component: [`apps/web/src/trust/VerdictReveal.tsx`](../../apps/web/src/trust/VerdictReveal.tsx)
- Styles: [`apps/web/src/trust/verdict-reveal.css`](../../apps/web/src/trust/verdict-reveal.css)
- Playground + controls: [`apps/web/src/trust/VerdictRevealDemo.tsx`](../../apps/web/src/trust/VerdictRevealDemo.tsx)
- Smoke test: [`apps/web/test/verdict-reveal.test.tsx`](../../apps/web/test/verdict-reveal.test.tsx)

**View it:** `pnpm --filter web dev`, then open `http://127.0.0.1:5173/#verdict-reveal`.
The demo loads only on that hash and is code-split, so three.js never enters the main app bundle.

How the single scalar works: a GSAP tween drives `uProgress` (0→1) on a WebGL fragment shader
that resolves a real asset (token chart/logo) from pixelated/dithered/displaced chaos to clarity.
The **residual** disorder at `uProgress = 1` is a function of `uVerdict` (CLEAR resolves clean,
CAUTION keeps a faint dither, DANGER keeps a red glitch and shakes). The same tween's `onUpdate`
writes a `--rp` CSS variable, so the ambient glow, scanning copy, and verdict panel stay in lockstep
with the shader.

---

## Full roster (72 verified practitioners)

_72 verified practitioners, alphabetical. Surfaced by a 6-angle web sweep; each line is the finder agents' summary of real, linked work._

- **Abeto** (studio) — Crafting interactive real-time experiences where the entire UI is rendered in WebGL/shaders, fusing procedural/scanned geometry with brand identity so the product page reads as one living material.
  - _Real-asset craft:_ On Igloo Inc they grew procedural ice crystals inside container shapes and rendered even the text/UI in WebGL with shader-driven glitches — reshaping volumetric/real-world-feeling material into the brand's surfaces rather than overlaying flat assets. Stack: Three.js, Svelte, GSAP, Houdini, Blender.
  - Link: [https://www.awwwards.com/sites/igloo-inc](https://www.awwwards.com/sites/igloo-inc) · [more](https://www.awwwards.com/igloo-inc-case-study.html)
- **Active Theory** (studio) — Cinematic, narrative-paced WebGL product/brand experiences that blend live-action footage, real-time video streams and 3D into one scroll/interactive timeline. Built their own engine (Hydra) and run disciplined performance budgets to keep heavy real media at 60fps.
  - _Real-asset craft:_ Treat real footage and live video as first-class scene material, not decoration: e.g. delivering live-stream video into a WebGL 'virtual auditorium' via Mux, and mixing live-action with real-time 3D product scenes (Adidas CHILE20) so the brand film and the interactive product feel like one continuous piece.
  - Link: [https://activetheory.net/](https://activetheory.net/) · [more](https://medium.com/active-theory/adidas-chile20-4744a75f5968)
- **Active Theory (Andy Thelander, Michael Anthony/Modena, Nick Mountford)** (studio) — Embedding live and recorded video streams directly inside real-time WebGL 3D worlds — solving the problem that you can't normally render a live video feed as a texture inside a browser WebGL scene at scale, then doing it for half-a-million concurrent attendees.
  - _Real-asset craft:_ For Porter Robinson's 'Secret Sky' virtual festival they piped live performance video streams (via Mux's infrastructure) directly into a WebGL virtual auditorium, displaying the real artist footage as a 3D-mapped surface inside the multiplayer world (desktop, mobile, VR). Real concert footage becomes the centerpiece texture of a navigable 3D space.
  - Link: [https://activetheory.net/](https://activetheory.net/) · [more](https://activetheory.net/work/secret-sky)
- **Adrián Gubrica** (person) — Highly-performant interactive WebGL experiences and visual 'illusions' as a Creative Developer at OFF+BRAND (a studio focused on premium product/brand launches)
  - _Real-asset craft:_ Specializes in optimizing and integrating media into interactive WebGL scenes — building illusions and performant shader-driven visuals where real assets are composited into product launch experiences.
  - Link: [https://tympanus.net/codrops/2025/12/05/from-illusions-to-optimization-the-creative-webgl-worlds-of-adrian-gubrica/](https://tympanus.net/codrops/2025/12/05/from-illusions-to-optimization-the-creative-webgl-worlds-of-adrian-gubrica/)
- **Andrew Prifer** (tool-author) — Core maintainer of Theatre.js and an author of its primary tutorials — teaching designers/developers to keyframe cinematic, motion-design-quality sequences (camera fly-throughs, scroll-scrubbed scenes) over real 3D/photo assets with a visual editor.
  - _Real-asset craft:_ His Codrops tutorial 'Animate a Camera Fly-through on Scroll Using Theatre.js and React Three Fiber' shows scrubbing a sequenced camera through a real 3D/scanned environment on scroll — bringing After-Effects-style keyframing to live web assets so footage-like motion feels native to the page.
  - Link: [https://tympanus.net/codrops/2023/02/14/animate-a-camera-fly-through-on-scroll-using-theatre-js-and-react-three-fiber/](https://tympanus.net/codrops/2023/02/14/animate-a-camera-fly-through-on-scroll-using-theatre-js-and-react-three-fiber/) · [more](https://github.com/theatre-js/theatre)
- **Aria Minaei** (tool-author) — Creator/lead of Theatre.js — built the visual motion-design editor that lets people author high-fidelity, hand-keyframed cinematic animation for real web/3D assets in the browser.
  - _Real-asset craft:_ Theatre.js provides a keyframe/sequence editor, tweak panel, scene-graph explorer and 3D editor so real Three.js scenes, models and photo-textured objects can be choreographed with motion-designer precision rather than code-only easing.
  - Link: [https://www.theatrejs.com/](https://www.theatrejs.com/) · [more](https://github.com/theatre-js/theatre)
- **Aristide Benoist** (person) — Native (vanilla) WebGL rendering of real photographic images and video footage as live GPU textures, bent through custom shaders into liquid page transitions, scroll distortions and reveal effects that feel native to each brand. Famous for hand-writing WebGL rather than leaning on Three.js, giving him total control over how real imagery deforms.
  - _Real-asset craft:_ Takes the actual film/photography assets from a movie (production stills, b-roll, key art) and loads them as GPU textures into a custom WebGL pipeline, then drives reveals, distortions and slider transitions off those real frames so the promo site feels like an extension of the film's grade. Did this for Ridley Scott's 'House of Gucci' (with WatsonDG / Index Studio) and the 'Mank — The Unmaking' digital art book for Netflix/David Fincher (with Watson Design Group).
  - Link: [https://aristidebenoist.com/](https://aristidebenoist.com/) · [more](https://aristidebenoist.com/house-of-gucci)
- **Aristide Benoist (with Ben Mingo)** (person) — Using machine learning + WebGL to 'bring photography to life' — animating still real photographs and threading real imagery through canvas-level page transitions
  - _Real-asset craft:_ Renders real photographs through the WebGL API on a single shared canvas so images carry across page transitions seamlessly, and uses ML to add motion/depth to otherwise static real photos (his and Ben Mingo's portfolio work, built native/vanilla WebGL with INDEX STUDIO).
  - Link: [https://www.awwwards.com/sites/ben-mingo-portfolio](https://www.awwwards.com/sites/ben-mingo-portfolio) · [more](https://aristidebenoist.com/ben-mingo)
- **basement.studio (José Rago, Facundo Santana)** (studio) — High-performance, design-forward web builds (Next.js/WebGL) that fuse physical material capture with web motion — a studio whose tagline is 'we make cool shit that performs,' working with Vercel, Linear, Cursor, MrBeast, KidSuper.
  - _Real-asset craft:_ Captures real physical material to use as texture in WebGL experiences — notably pouring wine on surfaces to capture genuine liquid texture for a WebGL piece — so the on-screen material derives from a real-world shoot rather than a procedural texture.
  - Link: [https://basement.studio/](https://basement.studio/) · [more](https://basement.studio/showcase/vercel)
- **basement.studio (Matías González Fernández)** (studio) — Productized, performant launch microsites for a single brand (Vercel) where heavy generated/real video and WebGL fluid simulations are bent into the brand's exact aesthetic and scroll-synced parallax/zoom — 'cool shit that performs.'
  - _Real-asset craft:_ For Vercel Ship they generated 15,000+ images and videos (Flux, Google Veo 2, Runway, Ideogram), then sculpted them into a custom ray-marched fluid/metallic system in Three.js and drove the reveals with Motion for React useTransform so the footage feels like one continuous brand material.
  - Link: [https://vercel.com/blog/designing-and-building-the-vercel-ship-conference-platform](https://vercel.com/blog/designing-and-building-the-vercel-ship-conference-platform) · [more](https://basement.studio/showcase/vercel)
- **Benji Taylor & Family (family.co)** (studio) — State-driven fluid UI motion where every transition preserves spatial/temporal continuity — wallet cards, address grouping, and morphing text that make abstract product actions feel physical and native.
  - _Real-asset craft:_ Less photographic footage and more 'real-feeling' material motion: shared-letter text morphs and self-organizing card animations that treat UI elements like real objects moving through space, so product state changes feel cinematic and tangible.
  - Link: [https://family.co/](https://family.co/) · [more](https://benji.org/family-values)
- **Bilawal Sidhu** (person) — Photoreal volumetric/real-world capture as motion media: 3D Gaussian Splatting and reality capture turning real scenes into free-viewpoint, relightable, editable 3D you can fly through — blending real footage with VFX and AI.
  - _Real-asset craft:_ Captures real environments/objects with cameras (e.g. Sony a7iii) and reconstructs them as Gaussian splats (RealityCapture + Lichtfeld), then animates, relights, and composites them with meshes — turning genuine photographic capture into navigable cinematic motion, increasingly renderable in Three.js for web/product UI.
  - Link: [https://bilawal.ai/](https://bilawal.ai/) · [more](https://x.com/bilawalsidhu/status/1803594507705106579)
- **Bradley G. Munkowitz (GMUNK)** (person) — Practical, in-camera capture of physical phenomena (sparks, infrared light fields, projected dot patterns, liquids) which he then designs into title sequences, music videos and brand films — a director/motion designer who insists on real captured material over pure CG.
  - _Real-asset craft:_ Discovered that the Microsoft Kinect's IR emitter projects a starfield dot pattern, then shot real infrared footage with a full-spectrum camera to create the bokeh/shimmer fields in Tycho's 'See'; for Maserati 'Spark the Next' he ran a practical spark shoot to capture genuine, spontaneous sparks rather than simulating them. He fuses these practical selects with motion design.
  - Link: [https://www.behance.net/gmunk](https://www.behance.net/gmunk) · [more](https://vimeo.com/106420288)
- **Bruno Arizio** (person) — After-Effects-to-WebGL workflow for finding a project's 'soul' — prototyping shaders/filters on real media in AE, then rebuilding them in GLSL with displacement transitions
  - _Real-asset craft:_ Experiments with shaders and filters on media in After Effects to define the look, then implements displacement/distortion transitions in vanilla JS + Three.js + GLSL + Locomotive Scroll; open-sourced his portfolio so the techniques are learnable.
  - Link: [https://tympanus.net/codrops/2019/12/18/case-study-portfolio-of-bruno-arizio/](https://tympanus.net/codrops/2019/12/18/case-study-portfolio-of-bruno-arizio/) · [more](https://github.com/bizarro/bruno-arizio)
- **Bruno Simon** (tool-author) — Created Three.js Journey, the definitive 91-hour course that teaches creative developers to build WebGL product/brand websites — including how to load and reshape real photographic textures, environment maps, baked photo-scanned models, and video onto geometry.
  - _Real-asset craft:_ Course chapters cover importing real-world textures and HDRI environment maps, applying them to materials, baking lighting from scanned/3D-captured assets in Blender, and using video and image textures on meshes so a real asset reads as native 3D in the browser.
  - Link: [https://threejs-journey.com/](https://threejs-journey.com/) · [more](https://thefwa.com/cases/threejs-journey-p2)
- **Buck (Ryan Honey, Orion Tait, Jeff Ellermeyer)** (studio) — Mixed-media motion design at scale — deliberately mixing 3D, 2D, live-action and real fabricated/physical objects within a single piece, with a studio culture built around medium-mixing experimentation.
  - _Real-asset craft:_ Translates pre-vis 3D timing into real physical fabrication then re-captures it: e.g., the Sherwin-Williams 'Come Together' spot was animated in 3D for timing, the shapes built in Illustrator, laser-cut from real wood and paper, hand-painted, and then stop-motion animated against the original previz — real objects reshaped to hit the brand's exact motion.
  - Link: [https://buck.co/](https://buck.co/) · [more](https://en.wikipedia.org/wiki/Buck_(design_company))
- **Cassie Evans** (person) — GreenSock/GSAP developer-educator who teaches lifelike, organic SVG + GSAP motion — turning hand-drawn and traced real artwork into morphing, stroke-drawing, masked, filter-driven animation with proper motion-design principles.
  - _Real-asset craft:_ Her SVG Animation Masterclass teaches structuring/optimising real illustration assets and unlocking SVG superpowers (clipping, masking, filters, morphing, MorphSVG/DrawSVG) so static vector art becomes whimsical, physical-feeling motion tied to the brand's illustration style.
  - Link: [https://www.cassie.codes/](https://www.cassie.codes/) · [more](https://www.plandonline.com/cassie-evans)
- **Chris Gannon** (person) — Award-winning interactive web animator known for tactile, springy, lifelike interactive SVG/2D-3D motion and micro-interactions; an early/prolific CodePen figure now also building data-driven UI in Rive.
  - _Real-asset craft:_ Specializes in giving abstract and illustrated UI elements organic, physics-like life (weight, bounce, follow-through) and is migrating that craft into Rive to build complex, data-driven interactive UI components.
  - Link: [https://gannon.tv/](https://gannon.tv/) · [more](https://codepen.io/chrisgannon/)
- **Daniel Velasquez** (person) — WebGL/creative-coding specialist focused on reshaping real photographic images via vertex/fragment shaders - z-displacement, aspect-ratio-preserving texture sampling, and configurable fullscreen distortion playgrounds.
  - _Real-asset craft:_ His 'Configurator for Creating Custom WebGL Distortion Effects' (Codrops) is a tool for distorting real photos with Three.js; his Everest.agency infinite-scroller deconstruction details sampling photos as textures and pushing vertices along Z by distance-from-center so real imagery gains depth as you scroll, without stretching the photo.
  - Link: [https://velasquezdaniel.com/blog/everest-agency-deconstruction/](https://velasquezdaniel.com/blog/everest-agency-deconstruction/) · [more](https://tympanus.net/codrops/2019/09/04/a-configurator-for-creating-custom-webgl-distortion-effects/)
- **darkroom.engineering (formerly Studio Freight)** (studio) — Defining the modern scroll-feel standard: authored Lenis, the smooth-scroll library that underpins a huge share of award-winning scroll-scrubbed footage/product sites; a 'global creative dev studio' building high-craft brand microsites.
  - _Real-asset craft:_ Their tooling (Lenis + Hamo) is the substrate that lets real video/footage be scrubbed and pinned to scroll smoothly; they apply it to client brand/product launch sites where footage reveals are tied to scroll position.
  - Link: [https://darkroom.engineering/](https://darkroom.engineering/) · [more](https://darkroom.engineering/about)
- **Dave Clark** (person) — Bringing traditional commercial/brand-film craft (he was a CD and commercial director) to GenAI narrative — emotionally grounded, cinematic AI shorts and ads with real story structure.
  - _Real-asset craft:_ Combines Midjourney imagery, Runway text-to-video, and ElevenLabs voice into cohesive narrative films, then directs them like a brand film; teaches a hybrid AI-advertising pipeline for high-end campaigns.
  - Link: [https://daveclarkcreative.com/about](https://daveclarkcreative.com/about) · [more](https://www.indiewire.com/news/business/dave-clark-gen-ai-company-promise-peter-chernin-1235067422/)
- **David Sheldrick** (person) — A genuinely distinctive 'image-hacking' craft: reshaping REAL physical archival media — 35,000+ colour film slides (1940–1990) plus 35mm film — through Stable Diffusion/Flux into layered, period-true brand visuals and motion. This is the clearest case of bending real photographic assets to fit a brand.
  - _Real-asset craft:_ Sources and restores real estate-sale film slides and 35mm photographs, then uses AI to transform and animate them, grounding synthetic output in tangible historical artifacts so the result reads as authentic photography rather than generic AI. Produces both stills and AI-generated video artwork (e.g. 'B'ak'tun').
  - Link: [https://www.instagram.com/davidsheldrick/](https://www.instagram.com/davidsheldrick/) · [more](https://thehouseoffineart.com/artists/288-david-sheldrick/)
- **Garden Eight** (studio) — Photography- and footage-forward editorial web design where real imagery/video is choreographed to scroll with refined typographic and motion pacing (Tokyo studio).
  - _Real-asset craft:_ Designs sites around real photographic/film assets (e.g. photographer portfolios and brand work), reshaping the footage with scroll-tied reveals, masking and pacing so the media is the experience, not an inset.
  - Link: [https://garden-eight.com/](https://garden-eight.com/) · [more](https://garden-eight.com/cases/)
- **Guido Rosso & Luigi Rosso (Rive)** (tool-author) — Co-founders of Rive — built the interactive real-time animation engine + state machine that lets teams ship lifelike, logic-driven motion (and increasingly real-image/mesh-warped) animation natively into real products across web, mobile and games.
  - _Real-asset craft:_ Rive supports vector + raster image assets, meshes and bones so designers can rig and skeletally deform real imagery, plus a state machine that makes motion react to live user input/data — animation that is the product UI, not a video overlay.
  - Link: [https://rive.app/](https://rive.app/) · [more](https://www.schoolofmotion.com/blog/rive)
- **Hello Monday / DEPT (Johanne Bruun Rasmussen, Jeppe Aaen, Andreas Anderskou, Anders Jessen)** (studio) — Interactive storytelling that mixes video, illustration and WebGL into joyful, character-driven digital experiences and products — known for hover/case-thumbnail effects rendered in WebGL (PixiJS) and for editorial interactive features.
  - _Real-asset craft:_ Integrates real video footage and photographic content into WebGL/PixiJS-driven interfaces (e.g., interactive editorial features blending video and illustration for clients like National Geographic), reshaping the footage so it reacts to cursor/scroll and sits inside the brand's interface system.
  - Link: [https://www.hellomonday.com/](https://www.hellomonday.com/) · [more](https://www.hellomonday.com/about)
- **Henry Daubrez** (person) — Two decades bridging award-winning interactive/digital product design (Dogstudio/DEPT, multiple FWA Site of the Year) with emotional AI cinema — 'agile filmmaking' that carries UI/brand-experience sensibility into generative motion.
  - _Real-asset craft:_ Builds short films with Veo 3 and Nano Banana, integrating generated footage with design-led art direction and storytelling; his background is literally bringing emotional storytelling into digital/web product formats for major brands.
  - Link: [https://promptscene.substack.com/p/google-labs-artist-henry-daubrez](https://promptscene.substack.com/p/google-labs-artist-henry-daubrez) · [more](https://upskydown.medium.com/)
- **Hernan Torrisi** (tool-author) — Creator of Bodymovin/Lottie (the After Effects -> JSON -> realtime-web pipeline) and a long-time interactive SVG animator; now at Rive building the next generation of interactive runtime animation.
  - _Real-asset craft:_ His core invention is the bridge that lets richly-animated AE compositions - including textured, lifelike motion - play back in realtime on web/app at tiny file sizes, the pipeline countless motion designers use to ship organic, brand-specific animation into product UI. Also builds interactive SVG (e.g. cursor-chasing chameleon).
  - Link: [https://rive.app/blog/founder-of-lottie-hernan-torrisi-joins-rive](https://rive.app/blog/founder-of-lottie-hernan-torrisi-joins-rive) · [more](https://x.com/airnanan)
- **Immersive Garden** (studio) — Paris studio specialized in design + animation + development of cinematic brand/product experiences blending video, motion and 3D into scroll-driven narratives.
  - _Real-asset craft:_ Integrates filmed/brand footage and rendered media into immersive scroll experiences where transitions, masking and 3D depth make the footage feel embedded in the product world rather than played in a box.
  - Link: [https://immersive-g.com/](https://immersive-g.com/) · [more](https://immersive-g.com/the-studio/)
- **Immersive Garden (Dilshan Arukatti)** (studio) — Photoreal-yet-performant cinematic WebGL: achieving high realism with minimal GPU load through engineered asset pipelines (server-side KTX texture compression, channel packing) so detailed real-world textures and bas-relief surfaces can run smoothly in the browser.
  - _Real-asset craft:_ Builds detailed natural/organic textures and bas-relief 3D surfaces (sculpted in Blender/Houdini, rendered in three.js) that reproduce the tactile feel of real materials — natural elements, stone, organic forms — and optimizes the real-texture detail via KTX/channel-packing so the materiality survives at web performance budgets.
  - Link: [https://immersive-g.com/](https://immersive-g.com/) · [more](https://www.awwwards.com/immersivegarden/)
- **Jason Zada / Secret Level** (studio) — Building per-brand 'AI Hollywood studios' — large-scale, multi-model AI production that reshapes a brand's own archival assets into new branded film; pioneered interactive/tech storytelling (Elf Yourself, Take This Lollipop) before AI.
  - _Real-asset craft:_ For Coca-Cola, regenerated the brand's archival 1995 'Holidays Are Coming' artwork and hand-drawn character designs through multiple generative models into a new globe-spanning branded film — reshaping real brand IP/heritage assets rather than inventing from nothing. Uses Topaz and several AI models in a 20-person pipeline.
  - Link: [https://www.secretlevel.co/about](https://www.secretlevel.co/about) · [more](https://en.wikipedia.org/wiki/Jason_Zada)
- **JcToon (Rive)** (person) — In-house Rive animator who builds fully interactive, state-machine-driven characters and UI - cursor-reactive scenes, click-to-zoom hero illustrations, skin-swapping characters and login mascots that respond live to user input.
  - _Real-asset craft:_ Works in Rive's mesh + bones rig system to add natural, organic deformation to illustrated characters, then wires state machines and listeners so the motion is genuinely interactive (not a baked loop) - the lifelike, squash-and-stretch feel of his rigs is the craft.
  - Link: [https://rive.app/@JcToon/](https://rive.app/@JcToon/) · [more](https://rive.app/marketplace/2244-7248-animated-login-character/)
- **Jean Mazouni** (person) — Mask-and-reveal manipulation of real film/photo media — draggable multi-screen video masks and film-photography galleries where the user physically uncovers real footage
  - _Real-asset craft:_ Built a draggable multi-screen mask effect over real videos (you drag a window that reveals different video feeds), and a '35mm' site dedicated to real film photography rendered through Three.js + GSAP with shader processing in an infinite media gallery.
  - Link: [https://tympanus.net/codrops/2025/03/20/developer-spotlight-jean-mazouni/](https://tympanus.net/codrops/2025/03/20/developer-spotlight-jean-mazouni/) · [more](https://www.jeanmazouni.com/)
- **Jesper Landberg** (person) — Independent creative developer focused on scroll mechanics — smooth scroll, drag/inertia navigation, distortion-on-scroll and image-grid scroll reveals; widely shared open-source scroll snippets used industry-wide.
  - _Real-asset craft:_ Specializes in scrubbing and distorting photographic image grids and media to scroll/drag input (skew/distortion effects), making real imagery feel kinetic and tied to the user's motion.
  - Link: [https://jesperlandberg.com/](https://jesperlandberg.com/) · [more](https://tympanus.net/codrops/hub/author/jesper/)
- **Jesper Landberg (ReGGae)** (person) — Lightweight velocity-based skew/distortion of real images on scroll and drag — the faster you move, the more the photo media warps
  - _Real-asset craft:_ Couples scroll/drag acceleration to a transform/skew applied to real image elements (and Codrops 'Smooth Scrolling Image Effects'), so real photos distort proportionally to interaction speed without heavy WebGL when not needed.
  - Link: [https://tympanus.net/codrops/2019/07/23/smooth-scrolling-image-effects/](https://tympanus.net/codrops/2019/07/23/smooth-scrolling-image-effects/) · [more](https://codepen.io/ReGGae/pen/pxMJLW)
- **Karen X. Cheng** (person) — Inventing viral, lifelike AI/real-media transformations and reverse-engineering reproducible workflows — pioneered chaining Midjourney/DALL·E stills into Runway Gen-1 video and seamless real-to-AI morphs.
  - _Real-asset craft:_ Films real footage of herself/real scenes and uses Runway Gen-1 and image models to restyle/transform it (e.g. the viral lawnmower transformation, infinite-zoom and morph effects), keeping real motion as the backbone so the AI restyle feels embodied rather than synthetic.
  - Link: [https://x.com/karenxcheng/status/1627721862565482496](https://x.com/karenxcheng/status/1627721862565482496) · [more](https://www.linkedin.com/posts/karenxcheng_testing-out-a-new-tool-for-creators-runway-activity-7034582200071163904-SEnx)
- **Keita Yamada (p5aholic)** (person) — Experimental, gallery-style WebGL treatments of imagery/media where real assets are warped, scrubbed and navigated as an infinite explorable space
  - _Real-asset craft:_ Uses Three.js + GSAP + Tweakpane to push imagery/media through custom WebGL experiments (sliding grids, navigable libraries of animations) where source media is distorted and recombined into a single explorable interface.
  - Link: [https://p5aholic.me/](https://p5aholic.me/) · [more](https://fontsinuse.com/uses/40419/web-graphic-experiments-by-keita-yamada)
- **Kyle Hamrick** (person) — School of Motion instructor for 'Premiere for Motion Designers' — teaches motion designers to edit, treat and weave real video footage and b-roll into motion projects and animatics.
  - _Real-asset craft:_ Curriculum is specifically about adding real footage to motion projects efficiently — cutting, pacing and integrating live-action b-roll so it sits inside designed/animated sequences rather than being a separate edit.
  - Link: [https://www.schoolofmotion.com/courses/premiere-for-motion-designers](https://www.schoolofmotion.com/courses/premiere-for-motion-designers) · [more](https://www.schoolofmotion.com/courses)
- **László Gaál** (person) — Cinematic AI commercial direction with a colorist's finishing eye — known for removing the 'plastic' look of raw AI video through 20 years of color grading, and even transferring AI footage onto real film stock for organic texture.
  - _Real-asset craft:_ Generates automotive spots in Veo (2/3), then reshapes them in post — grading, regraining, and film-transfer — to match a specific car brand's visual language and continuity; combines generated plates with finishing craft so they read as real shot footage.
  - Link: [https://www.laszlogaal.com/](https://www.laszlogaal.com/) · [more](https://petapixel.com/2025/05/09/this-is-the-first-ai-video-to-be-transferred-onto-film-laszlo-gaal/)
- **Luis Henrique Bizarro (lhbzr / BIZARRØ)** (person) — Real-time 3D/WebGL creative technology focused on GLSL shaders that treat photographic and video media as deformable materials — infinite scroll galleries, displacement/RGB-shift transitions, and footage-driven hover/scroll effects, often hand-built on lightweight OGL rather than heavy frameworks.
  - _Real-asset craft:_ Loads brand imagery and video as GPU textures and writes GLSL to displace, warp and shift them on scroll/cursor input (e.g., his widely-referenced infinite auto-scrolling gallery with OGL + GLSL), so real product/editorial photography becomes fluid, physically-reactive motion.
  - Link: [https://lhbzr.com/](https://lhbzr.com/) · [more](https://tympanus.net/codrops/2021/01/05/creating-an-infinite-auto-scrolling-gallery-using-webgl-with-ogl-and-glsl-shaders/)
- **Luis Henrique Bizarro (lhbzr / Bizarro)** (person) — High-end real-time WebGL/WebGPU treatment of brand footage and imagery for global product launches and music/fashion brands
  - _Real-asset craft:_ Builds real-time 3D pipelines (WebGL/WebGPU + custom shaders) that take brand video and photography and reshape them into interactive launch experiences across web, installations and apps.
  - Link: [https://lhbzr.com/](https://lhbzr.com/) · [more](https://tympanus.net/codrops/author/lhbzr/)
- **Lusion (Edan Kwan)** (studio) — Award-winning real-time 3D/WebGL storytelling with a strong emphasis on organic, physical-feeling motion (particles, fluid sims, lifelike materials) engineered for performance — a studio whose whole identity is 'real-time application focused' visual craft.
  - _Real-asset craft:_ Of the Oak fuses real-world capture (photogrammetry, LiDAR, CT scans, ground-penetrating radar of an actual oak) into an interactive scrollable field guide, reshaping scientific scans of a real object into a navigable brand/experience; Porsche: Dream Machine blends CG with film for a product brand piece.
  - Link: [https://blooloop.com/of-the-oak/](https://blooloop.com/of-the-oak/) · [more](https://github.com/lusionltd/WebGL-Scroll-Sync)
- **Lusion (Lusion Ltd)** (studio) — Award-winning Bristol real-time/3D web studio that turns real products into explorable real-time WebGL hero experiences - reproducing a client's physical product as a high-fidelity real-time visual prototype the client can inspect from every angle in-browser.
  - _Real-asset craft:_ Builds custom real-time assets from real product references (e.g. car/product visualizers like GEMINI, Surface Floater) so a brand's actual product becomes an interactive, accurately-portrayed real-time object rather than stock 3D. Every visual on their own site uses custom assets to push fidelity.
  - Link: [https://lusion.co/](https://lusion.co/) · [more](https://exp-gemini.lusion.co/)
- **Manoela Ilic & Mary Lou (Codrops / Tympanus)** (studio) — Run Codrops, the long-running tutorial publication that has taught a generation the exact craft of reshaping real images/video with WebGL — distortion hover effects, displacement maps, liquid transitions, depth-map scanning, video transitions and DOM-to-WebGL galleries.
  - _Real-asset craft:_ Codrops tutorials repeatedly take real photos/video as textures and bend them: WebGL displacement hover effects, liquid distortion slideshows, curtains.js video transitions, WebGPU depth-map scanning, and smooth DOM-image-to-WebGL parallax galleries.
  - Link: [https://tympanus.net/codrops/2018/04/10/webgl-distortion-hover-effects/](https://tympanus.net/codrops/2018/04/10/webgl-distortion-hover-effects/) · [more](https://tympanus.net/codrops/2020/10/07/webgl-video-transitions-with-curtains-js/)
- **ManvsMachine (Mike Alderson, Tim Swift, Mike Sharpe)** (studio) — Blending live-action cinematography, practical/physical shoots and 3D/CGI into a single brand language for motion — the studio is built on the 'collision point between conceptual and technical', specializing in moving image where motion design meets graphic design and branding.
  - _Real-asset craft:_ For Nike Air Max they 3D-scanned nine real Air Max shoes, physically built and filmed Tinker Hatfield's design studio, and shot practical sequences (milk explosions, on-set raves, people in giant inflated suits, VHS footage) — then composited that real footage with CGI and typographic design so the physical material reads as part of the product story. Air Max 2017 turns billowing fabric and bubbles (shot/simulated) into negative-space renders of the shoe.
  - Link: [https://mvsm.com/](https://mvsm.com/) · [more](https://mvsm.com/project/air-max)
- **Mark Christiansen** (person) — Lead instructor of School of Motion's 'VFX for Motion' — teaches the literal craft of integrating real live-action footage into motion design: keying, roto, tracking, matchmoving and compositing CG/graphic elements onto real plates.
  - _Real-asset craft:_ Course uses professionally shot, real footage assignments; students learn to key/roto/track real plates and match-move 2D and 3D objects into moving-camera scenes so added graphics sit convincingly inside the real footage.
  - Link: [https://www.schoolofmotion.com/courses/vfx-for-motion](https://www.schoolofmotion.com/courses/vfx-for-motion) · [more](https://www.schoolofmotion.com/blog/vfx-for-motion-breakdowns)
- **Matt Perry** (tool-author) — Creator of Framer Motion / Motion (and Popmotion, Motion One) — built the dominant React/web animation libraries that make spring-physics, gesture- and scroll-driven, organic motion easy to apply to real UI and media in production.
  - _Real-asset craft:_ Motion's spring physics, layout animations, scroll-linked useScroll/useTransform and gesture system are the engine countless teams use to animate real product imagery/video and UI so transitions feel physical and native rather than canned CSS.
  - Link: [https://motion.dev/about](https://motion.dev/about) · [more](https://x.com/mattgperry)
- **Meng To** (person) — Founder of Design+Code; course author teaching designers to build animated, motion-rich product UI (SwiftUI + React/web), including integrating Rive-authored interactive animation and real-asset 3D into shipping app interfaces.
  - _Real-asset craft:_ His 'Build an Animated App with Rive and SwiftUI' and SwiftUI animation courses show wiring designer-authored interactive animation and matched-geometry transitions onto real product screens so motion is native to the app, not a separate video.
  - Link: [https://designcode.io/courses/](https://designcode.io/courses/) · [more](https://designcode.io/swiftui-rive/)
- **mount inc.** (studio) — Interactive 'touchable video' scrubbing — re-encoding real product footage so a user's drag/scroll scrubs it frame-by-frame, making real film feel like a directly manipulable physical object
  - _Real-asset craft:_ Shot real video of design tools/products, then re-encoded with ffmpeg using shortened keyframe intervals (-g 12) plus a WebCodecs/mediabunny fallback so dragging precisely scrubs the captured footage. Layered WebGL line-blur (depth-of-field) and 3D over the live footage. The point is the literal tactile sensation of the real recorded object.
  - Link: [https://tympanus.net/codrops/2025/11/20/behind-the-kai-design-dept-experience-webgl-line-blur-video-scrubbing-and-3d-animation/](https://tympanus.net/codrops/2025/11/20/behind-the-kai-design-dept-experience-webgl-line-blur-video-scrubbing-and-3d-animation/) · [more](https://mount.jp/)
- **Nicolas Neubert** (person) — AI-native cinematic motion direction from a product-design background — turning Midjourney stills into coherent, moody trailer-grade motion with strong narrative pacing, color, and sound design. He documents reproducible prompt-to-edit workflows.
  - _Real-asset craft:_ Generates lifelike imagery in Midjourney, then animates camera moves / depth in Runway Gen-2, assembling 40+ AI clips into a continuous cinematic cut. His 'Genesis' trailer (316 prompts, 310 Runway videos, 44 used) was one of the first AI trailers screened in cinemas; he applies the same approach to product/brand contexts via Runway and his VW/Elli product-design work.
  - Link: [https://www.iamneubert.com](https://www.iamneubert.com) · [more](https://venturebeat.com/ai/meet-the-ai-creative-senior-product-designer-nicolas-neubert-creator-of-sci-fi-movie-trailer-genesis)
- **Olivier Larose** (person) — Creative-dev educator whose blog/YouTube teach reshaping real images into product-grade scroll and WebGL motion — image distortion on mouse/scroll, ripple/wave displacement shaders, masked image reveals and parallax with React Three Fiber + Framer Motion.
  - _Real-asset craft:_ Tutorials take real photos and curve/distort them on mouse move, apply ripple and 3D wave displacement shaders, reveal them via SVG masks and clip-paths, and parallax them on scroll — each with live demos and source so the technique transfers to a real product.
  - Link: [https://blog.olivierlarose.com/tutorials](https://blog.olivierlarose.com/tutorials) · [more](https://blog.olivierlarose.com/tutorials/3d-wave-on-scroll)
- **Patrick Heng** (person) — Restrained, craft-invisible WebGL media motion plus custom shader tooling (ex Active Theory / Sweet Punk)
  - _Real-asset craft:_ Codes WebGL-driven media transitions and displacement for client/portfolio sites (collaborated on Robin Mastromarino's velocity-displacement slider), and builds a shader testing/export tool and visual template generators that shape media into product motion.
  - Link: [https://patrickheng.com/](https://patrickheng.com/) · [more](https://www.awwwards.com/sites/patrick-heng-portfolio-1)
- **Paul Trillo** (person) — A signature 'infinite/endless dolly-zoom' motion grammar he developed over 10+ years in live action and then extended into AI — stitching shots into one seamless impossible continuous move. Distinctive, lifelike, and unmistakably his.
  - _Real-asset craft:_ Blends real in-camera/live-action technique with AI generation: for the first commissioned Sora music video he generated 700 clips and selected 55 to build a continuous never-ending dolly through a couple's whole life — applying a real cinematographic move to AI footage so it feels photographic, not synthetic.
  - Link: [https://www.paultrillo.com/](https://www.paultrillo.com/) · [more](https://nofilmschool.com/ai-music-video)
- **Phantom (Phantom.Land / Phantom Studios)** (studio) — London/Auckland creative-engineering studio blending elegant real-time 3D rendering with real-world data and AR capture - immersive interactive storytelling that overlays live/real information onto real environments.
  - _Real-asset craft:_ Uses smartphone-camera capture/AR to scan real printed pages and the real world, then reveals real-time data visualizations registered to those real surfaces (e.g. AR data overlays integrating live Google Trends data; Qibla Finder browser AR using the device's real-world orientation/camera).
  - Link: [https://www.phantom.land/](https://www.phantom.land/) · [more](https://www.awwwards.com/sites/phantom-land)
- **PJ Accetturo (PJ Ace)** (person) — Art-directing AI video with live-action-director precision to produce viral, photoreal broadcast commercials at extreme speed and low cost — a repeatable 'prompt-to-primetime' ad pipeline.
  - _Real-asset craft:_ Generates every shot in tools like Veo 3 / Runway / Sora, then edits and directs them with cinematography, pacing, and casting logic borrowed from real production; mixes hyperreal generated footage to hit a brand's tone (GTA-style narrative for Kalshi, etc.).
  - Link: [https://x.com/pjaccetturo](https://x.com/pjaccetturo) · [more](https://petapixel.com/2025/06/12/the-most-unhinged-ai-generated-gambling-ad-ran-during-the-nba-finals/)
- **Praneeth Kawya Thathsara (RiveAnimator)** (person) — Rive animation specialist for solo devs, SaaS, iOS and Web3 products - builds interactive mascots, character states, UI motion, loaders and onboarding as developer-ready Rive files, plus publishes detailed how-to content on turning static mascots into interactive systems.
  - _Real-asset craft:_ Uses Rive bones/mesh rigging and state machines to make illustrated mascots deform and react organically to interaction (Duolingo-style characters, animated icons), then hands off production-ready state-machine files developers wire to real product events/data.
  - Link: [https://riveanimator.com/](https://riveanimator.com/) · [more](https://dev.to/uianimation/how-to-turn-any-mascot-illustration-into-a-fully-interactive-rive-animation-43if)
- **Resn** (studio) — Building an entire brand motion system first (animation curves, reaction movement, perspective shifts) and then expressing it through a cinematic, scroll-driven product hub — so the website is the first application of a coherent kinetic brand language.
  - _Real-asset craft:_ Reshape brand/product film and rendered footage into the site's juxtaposition-and-dimensionality motion grammar; cinematic sequences are choreographed to scroll so live-action/film material reads as native to the brand's visual system rather than embedded clips.
  - Link: [https://www.awwwards.com/sites/zentry](https://www.awwwards.com/sites/zentry) · [more](https://www.dutchdigital.design/cases/zentry-by-resn)
- **Resn (Rik Campbell, Steve Le Marquand; Design Director Bruno Arizio)** (studio) — Highly art-directed, surreal/experimental immersive WebGL experiences — the studio's ethos is 'perverting' digital norms to make captivating, story-driven 3D worlds with strong identity systems and embedded motion.
  - _Real-asset craft:_ Composites photographic/filmed and rendered material into surreal interactive WebGL scenes (e.g., experimental WebGL burning-trophy and 3D-space pieces) where real textures are bent into the brand's fictional world; under Design Director Bruno Arizio, identity systems are built so motion is embedded in every element, even when static.
  - Link: [https://www.awwwards.com/resn/](https://www.awwwards.com/resn/) · [more](https://www.awwwards.com/sites/kpr)
- **Robin Mastromarino** (person) — Velocity-driven displacement of media sliders — image/media planes that deform with rounded-edge warping based on the user's scroll and drag speed
  - _Real-asset craft:_ Builds near-fully-WebGL sites (Three.js) where slider media is displaced and round-edge-deformed in real time as a function of scroll/drag velocity, so the real imagery physically reacts to how hard you push it.
  - Link: [https://www.awwwards.com/sites/robin-mastromarino-portfolio-1](https://www.awwwards.com/sites/robin-mastromarino-portfolio-1) · [more](https://orpetron.com/sites/robin-mastromarino-portfolio/)
- **Robin Noguier** (person) — Interactive designer/creative developer building WebGL-powered scroll experiences and portfolio/brand sites where imagery is rendered and transitioned in WebGL (React/Next.js), producing smooth, cinematic project navigation.
  - _Real-asset craft:_ Renders project/brand photography and video into WebGL layers so the real imagery powers scroll-driven reveals and transitions (his Codrops article 'Implementing WebGL Powered Scroll Animations' documents the approach), making client photo/video the kinetic surface of the site.
  - Link: [https://robin-noguier.com/](https://robin-noguier.com/) · [more](https://thefwa.com/cases/robin-noguier-portfolio)
- **Robin Payot** (person) — Senior creative developer and YouTube/Codrops tutorial author who teaches WebGL distortion, grain, refraction and displacement techniques and applies them to real brand product campaigns.
  - _Real-asset craft:_ Publishes step-by-step tutorials on reshaping rendered/photographic surfaces — 'Creating a Bulge Distortion Effect with WebGL' and 'Creating a Risograph Grain Light Effect in Three.js' — and uses custom refraction/displacement shaders on real product imagery in client work.
  - Link: [https://robinpayot.com/](https://robinpayot.com/) · [more](https://tympanus.net/codrops/2025/06/12/developer-spotlight-robin-payot/)
- **Roman Jean-Elie** (person) — Film-director-informed WebGL motion — scroll-velocity stretch on media/typography and minimal cinematic composition (ex film/theatre director turned creative dev)
  - _Real-asset craft:_ Renders titles and media as WebGL textures with a scroll-velocity-driven stretch effect; backgrounds and elements composed with a director's eye (R3F + GSAP), and his work history (Immersive Garden, Mazarine) centers on film & promotional media.
  - Link: [https://tympanus.net/codrops/2025/11/27/letting-the-creative-process-shape-a-webgl-portfolio/](https://tympanus.net/codrops/2025/11/27/letting-the-creative-process-shape-a-webgl-portfolio/) · [more](https://www.romanjeanelie.com/)
- **Ruairi Robinson** (person) — Oscar-nominated live-action director's craft applied to hyperreal AI video — sequences convincing enough to blur fiction and reality, built with frontier models and grounded in real cinematic staging.
  - _Real-asset craft:_ Generates sequences with new models (e.g. Seedance 2.0) and composes them with real directorial blocking, lensing, and edit rhythm; his AI-only music video 'The Blue Stone' re-imagines a Danse Macabre with motion that reads as shot footage.
  - Link: [https://www.ruairirobinson.com/about](https://www.ruairirobinson.com/about) · [more](https://shots.net/news/view/how-ruairi-robinson-used-ai-to-dance-with-the-death)
- **Samsy (Samuel Honigstein)** (person) — Cinematic, world-building WebGL/WebGPU environments that integrate media into immersive interactive spaces (incl. multiplayer)
  - _Real-asset craft:_ Builds immersive 3D worlds (Three.js TSL / WebGPU) where media and textures are composited into navigable cinematic environments rather than flat galleries; 60+ awards including Google Creative Lab projects.
  - Link: [https://samsy.ninja/](https://samsy.ninja/) · [more](https://www.webgpu.com/showcase/gen-02-portfolio-an-immersive-world/)
- **Sarah Drasner** (person) — Author/educator on SVG animation — wrote O'Reilly's 'SVG Animations' and teaches (Frontend Masters) how to turn real vector artwork into complex, responsive, UX-driven motion.
  - _Real-asset craft:_ Teaches taking her own (and brands') SVG illustration assets and animating them — coordinated multi-element choreography, responsive animation, and UX-purposeful motion — so static art becomes interface motion.
  - Link: [https://www.amazon.com/SVG-Animations-Implementations-Responsive-Animation/dp/1491939702](https://www.amazon.com/SVG-Animations-Implementations-Responsive-Animation/dp/1491939702) · [more](https://sarah.dev/writing/)
- **Stefan Vitasović** (person) — Treating real video as a programmable WebGL texture with a built-in 'look' — LED/halftone overlay + noise grain baked into the fragment shader so heavily-compressed footage still feels intentional and filmic
  - _Real-asset craft:_ Loads real project videos as Three.js textures and runs them through a fragment shader that adds an LED-grid overlay and noise grain. This lets him crush video bitrate (smaller files) while the artifacts read as a deliberate aesthetic, and it gives every clip the same product-native texture across a WebGL video grid.
  - Link: [https://tympanus.net/codrops/2025/03/05/case-study-stefan-vitasovic-portfolio-2025/](https://tympanus.net/codrops/2025/03/05/case-study-stefan-vitasovic-portfolio-2025/) · [more](https://stefanvitasovic.dev/)
- **Takayosi Amagi (fand / AMAGI)** (tool-author) — Authoring VFX-JS / REACT-VFX — a library that attaches WebGL/glitch shader effects directly to plain <img> and <video> (and now HTML-in-canvas) elements, automatically loading them as textures
  - _Real-asset craft:_ VFX-JS auto-loads any real <video> or <img> as a WebGL texture and applies shaders (RGB shift, glitch, displacement) with almost no setup, so designers can apply chromatic-aberration/glitch motion to real footage and photos as easily as CSS.
  - Link: [https://tympanus.net/codrops/2025/01/20/vfx-js-webgl-effects-made-easy/](https://tympanus.net/codrops/2025/01/20/vfx-js-webgl-effects-made-easy/) · [more](https://github.com/fand/vfx-js)
- **Thibault Guignand** (person) — Single-uniform 'melting' video transitions — driving a full-screen carousel of real project footage with one GSAP-tweened progress value that simultaneously fires a noise block-reveal, displacement warp, and chromatic aberration
  - _Real-asset craft:_ Real client/project videos run as native HTML5 playback, then only the two videos involved in a transition are uploaded as WebGL textures and melted into each other: UVs pixelated against a static noise texture for binary block-reveal, a scrolling noise texture warps the footage (parabolic peak at 50%), and R/B channels offset for chromatic aberration mid-transition.
  - Link: [https://tympanus.net/codrops/2026/05/06/from-shader-uniforms-to-clip-path-wipes-how-gsap-drives-my-portfolio/](https://tympanus.net/codrops/2026/05/06/from-shader-uniforms-to-clip-path-wipes-how-gsap-drives-my-portfolio/) · [more](https://www.thibaultguignand.com)
- **Toshiya Marukubo** (person) — Localized shader distortion of image media on interaction — sine-wave warps on hover and radial blur scaled by scroll speed
  - _Real-asset craft:_ Transforms image carousels with localized sine-wave distortion on mouse hover and radial blur intensified by scroll velocity, using Three.js + GSAP + custom shaders, so real imagery deforms exactly where and as fast as the user interacts.
  - Link: [https://toshiya-marukubo.github.io/](https://toshiya-marukubo.github.io/) · [more](https://tympanus.net/codrops/2022/11/26/awesome-demos-roundup-22/)
- **Tristan Bagot** (person) — Creative-coding art direction that integrates real video/photographic assets into web experiences as the medium — WebGL/shader-driven, scroll-based interactive sites for fashion and culture brands. (Award-winning craft side of the real-footage-into-UI angle.)
  - _Real-asset craft:_ Uses real video and photographic source extensively, reshaping it through WebGL shaders, displacement, and scroll interaction so footage becomes native, reactive interface motion rather than a passive background — bending real media to each brand's site language.
  - Link: [https://www.tristanbagot.com/](https://www.tristanbagot.com/) · [more](https://www.usbynight.be/artist/tristan-bagot/)
- **Unseen Studio (formerly Green Chameleon), Bristol** (studio) — Real-time 'interactive cinematic' brand experiences — building film-grade, emotionally-graded 3D worlds in the browser that behave like a guided film while remaining interactive, using a custom Theatre.js-driven camera/sequencing pipeline plus WebGL optimization (god rays, impostors, GPU instancing/LOD).
  - _Real-asset craft:_ For 'The Symphony of Vines' (Chateau brand site) they translate the real terroir — vines, rock, light, atmosphere of a Bordeaux estate — into a WebGL world: photographic mood references inform the grade, god rays simulate the estate's real light, and impostor/billboard techniques fake high-detail vineyard geometry at distance so the scene reads as the actual vineyard while staying performant.
  - Link: [https://unseen.co/](https://unseen.co/) · [more](https://symphonyofvines.unseen.co/)
- **Utsubo** (studio) — Osaka technology-first creative studio specializing in real-time, interactive captures of the real world - Gaussian splatting, point clouds, and body-driven particle fields used in web experiences and physical installations.
  - _Real-asset craft:_ Captures real objects/people/spaces via photogrammetry and 3D/Gaussian-splat scanning, then drives them as interactive point clouds and particle systems (e.g. an interactive Hokusai installation at Expo 2025 Osaka where visitors' bodies control real-captured motion fields in real time).
  - Link: [https://www.utsubo.com/blog/interactive-point-cloud-installations-guide](https://www.utsubo.com/blog/interactive-point-cloud-installations-guide) · [more](https://www.utsubo.com/blog/gaussian-splatting-guide)
- **Yuri Artiukh (akella)** (person) — Shader-driven manipulation of real photographic imagery: image-to-image transitions, ripple/displacement, pixelated distortion, fluid distortion and recursive texture sliders in Three.js / PixiJS. Also a leading public educator - his 'ALL YOUR HTML' YouTube streams reverse-engineer award-winning sites live.
  - _Real-asset craft:_ Loads real photos/video as GL textures and drives them with data-textures, displacement maps and fluid sims so the imagery warps, ripples and dissolves on interaction. Tutorials include 'Creating a Fluid Distortion Animation', 'Ripple Effect on a Texture', 'Pixelated Distortion Effect', 'On-Scroll Revealing WebGL Images', plus a Gaussian-splatting glass-portal card that pulls real scanned objects into UI.
  - Link: [https://github.com/akella/webGLImageTransitions](https://github.com/akella/webGLImageTransitions) · [more](https://medium.com/@akella/taotajima-jp-webgl-deconstruction-af4946e8e8ed)

---

_Generated 2026-06-28 from a multi-agent web research sweep. Links are as surfaced by the finder agents; spot-check before citing externally._
