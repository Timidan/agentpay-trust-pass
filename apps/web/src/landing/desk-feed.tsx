import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useRef } from "react";
import { RUN, short } from "./desk-data";

gsap.registerPlugin(useGSAP);

type KvProps = {
  k: string;
  v: string;
  wraps?: boolean;
  tick?: boolean;
};

function Kv({ k, v, wraps = false, tick = false }: KvProps) {
  const reveal = tick ? { "data-tick": "" } : { "data-typed": "" };
  return (
    <div className={`lv-desk-line${wraps ? " wraps" : ""}`} {...reveal}>
      <span className="lv-desk-k">{k}</span>
      <span className="lv-desk-v">{v}</span>
    </div>
  );
}

/**
 * The hero desk panel: one full settlement run on a looping GSAP timeline.
 * Markup renders the final settled state by default; motion is layered on
 * top only when the user allows it, so reduced-motion and no-JS both get
 * the complete, legible end state.
 */
export function DeskFeed() {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const root = scope.current;
      if (!root) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
      if (reduce.matches) return;

      root.classList.remove("is-static");

      const view = root.querySelector<HTMLElement>(".lv-desk-feedview");
      const stream = root.querySelector<HTMLElement>(".lv-desk-feedstream");
      const word = root.querySelector<HTMLElement>(".lv-desk-stateword");
      const check = root.querySelector<HTMLElement>(".lv-desk-statecheck");
      const ring = root.querySelector<HTMLElement>(".lv-desk-feedring");
      const runEl = root.querySelector<HTMLElement>(".lv-desk-feedrun");
      if (!view || !stream || !word || !check || !ring || !runEl) return;

      const block = (name: string) =>
        root.querySelector<HTMLElement>(`[data-fb="${name}"]`) as HTMLElement;
      const bIntro = block("intro");
      const bQuote = block("quote");
      const bGate = block("gate");
      const bPay = block("pay");
      const bVerify = block("verify");
      const bReceipt = block("receipt");

      const typedIn = (el: HTMLElement) =>
        el.querySelectorAll<HTMLElement>("[data-typed]");
      const ticksIn = (el: HTMLElement) =>
        el.querySelectorAll<HTMLElement>("[data-tick]");

      const typedAll = [bIntro, bQuote, bGate, bPay, bVerify, bReceipt].flatMap(
        (b) => Array.from(typedIn(b)),
      );
      const ticksAll = [bVerify, bReceipt].flatMap((b) => Array.from(ticksIn(b)));
      const settledLine = bPay.querySelector<HTMLElement>("[data-settled]");
      const rootLine = bVerify.querySelector<HTMLElement>("[data-rootmatch]");

      const setState = (text: string) => () => {
        word.textContent = text;
        gsap.fromTo(
          word,
          { y: 7, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, duration: 0.28, ease: "power2.out" },
        );
      };

      const follow = (el: HTMLElement, position?: string) =>
        tl.to(
          stream,
          {
            y: () => {
              const over = el.offsetTop + el.offsetHeight + 16 - view.clientHeight;
              return -Math.max(0, over);
            },
            duration: 0.5,
            ease: "power2.inOut",
          },
          position,
        );

      let runCount = 0x2f41;

      const tl = gsap.timeline({
        repeat: -1,
        repeatDelay: 3,
        repeatRefresh: true,
        defaults: { ease: "power2.out" },
        onRepeat: () => {
          runCount += 1;
          runEl.textContent = `run 0x${runCount.toString(16)}`;
        },
      });

      const typeLines = (
        el: HTMLElement,
        position?: string | number,
        stagger = 0.18,
      ) =>
        tl.to(
          typedIn(el),
          {
            clipPath: "inset(-2px 0% -2px 0)",
            duration: 0.45,
            ease: "steps(22)",
            stagger,
          },
          position,
        );

      // Loop-start reset: everything hidden, stream back at the top.
      tl.set(stream, { y: 0 }, 0);
      tl.set(typedAll, { clipPath: "inset(-2px 100% -2px 0)" }, 0);
      tl.set(bGate, { autoAlpha: 0 }, 0);
      tl.set(ticksAll, { autoAlpha: 0, x: -8 }, 0);
      tl.set([settledLine, rootLine], { autoAlpha: 0 }, 0);
      tl.set(check, { autoAlpha: 0, scale: 0.4 }, 0);
      tl.set(ring, { autoAlpha: 0 }, 0);

      // 1. Quote composes in.
      tl.call(setState("assembling"), undefined, 0.01);
      typeLines(bIntro, 0.15);
      typeLines(bQuote, 0.7);
      follow(bQuote, "<0.4");

      // 2. The 402 gate interjects.
      tl.call(setState("locked"), undefined, "+=0.55");
      tl.fromTo(
        bGate,
        { autoAlpha: 0, scaleY: 0.6, transformOrigin: "top left" },
        { autoAlpha: 1, scaleY: 1, duration: 0.3, ease: "power3.out" },
      );
      typeLines(bGate, "<");
      tl.fromTo(ring, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.14 }, "<");
      tl.to(ring, { autoAlpha: 0, duration: 0.7 }, "+=0.45");
      follow(bGate, "<");

      // 3. The signed x402 payload answers it.
      tl.call(setState("settling"), undefined, "+=0.35");
      typeLines(bPay, undefined, 0.15);
      follow(bPay, "<1.0");
      tl.fromTo(
        settledLine,
        { autoAlpha: 0, y: 6 },
        { autoAlpha: 1, y: 0, duration: 0.35 },
        "+=0.25",
      );
      follow(bPay);

      // 4. Merkle verification ticks hash by hash.
      tl.call(setState("verifying"), undefined, "+=0.4");
      typeLines(bVerify, undefined, 0);
      tl.to(
        ticksIn(bVerify),
        { autoAlpha: 1, x: 0, duration: 0.32, stagger: 0.42 },
        "<0.2",
      );
      follow(bVerify, "<0.5");
      tl.fromTo(
        rootLine,
        { autoAlpha: 0, clipPath: "inset(-2px 100% -2px 0)" },
        {
          autoAlpha: 1,
          clipPath: "inset(-2px 0% -2px 0)",
          duration: 0.5,
          ease: "steps(26)",
        },
        "+=0.3",
      );
      follow(bVerify);

      // 5. The registry receipt prints.
      tl.call(setState("recording"), undefined, "+=0.45");
      typeLines(bReceipt, undefined, 0);
      tl.to(
        ticksIn(bReceipt),
        { autoAlpha: 1, x: 0, duration: 0.3, stagger: 0.16 },
        "<0.2",
      );
      follow(bReceipt, "<0.4");

      // Settled.
      tl.call(setState("recorded"), undefined, "+=0.4");
      tl.fromTo(
        check,
        { autoAlpha: 0, scale: 0.4 },
        { autoAlpha: 1, scale: 1, duration: 0.4, ease: "back.out(2.4)" },
        "<0.1",
      );
    },
    { scope },
  );

  return (
    <div className="lv-desk-feed is-static" ref={scope}>
      <p className="lv-desk-sronly">
        Example settlement run: the desk quotes a report at {RUN.amount} with a
        committed dataset root, locks it behind HTTP 402, settles a signed x402
        payment, verifies the Merkle path to the quoted root, and records the
        receipt on the AgentPayRegistry contract on Casper testnet.
      </p>
      <div className="lv-desk-feedbar" aria-hidden="true">
        <span className="lv-desk-feedtitle">Example · settlement desk</span>
        <span className="lv-desk-feedrun">run 0x2f41</span>
        <span className="lv-desk-feedstate">
          <span className="lv-desk-stateword">recorded</span>
          <svg
            className="lv-desk-statecheck"
            viewBox="0 0 12 12"
            fill="none"
            width="12"
            height="12"
          >
            <path
              d="M1.5 6.5 4.6 9.6 10.5 2.8"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>
      <div className="lv-desk-feedview" aria-hidden="true">
        <div className="lv-desk-feedstream">
          <section className="lv-desk-fb" data-fb="intro">
            <div className="lv-desk-comment" data-typed>
              # assembling report · live casper rpc + cspr.trade observations
            </div>
          </section>

          <section className="lv-desk-fb" data-fb="quote">
            <div className="lv-desk-fblabel" data-typed>
              quote <span className="dim">· {RUN.quoteId}</span>
            </div>
            <Kv k="dataset" v={RUN.datasetId} />
            <Kv k="root" v={RUN.datasetRoot} wraps />
            <Kv k="amount" v={`${RUN.amount} · ${RUN.amountMotes}`} />
            <Kv k="expires" v={`${RUN.expiresAt} · ttl ${RUN.ttl}`} />
          </section>

          <section className="lv-desk-fb lv-desk-fbgate" data-fb="gate">
            <div className="lv-desk-gatehead" data-typed>
              HTTP 402 Payment Required
            </div>
            <div className="lv-desk-comment" data-typed>
              report locked · awaiting x402 settlement for {RUN.quoteId}
            </div>
          </section>

          <section className="lv-desk-fb" data-fb="pay">
            <div className="lv-desk-fblabel" data-typed>
              x402 payment <span className="dim">· answers {RUN.quoteId}</span>
            </div>
            <Kv k="scheme" v="x402" />
            <Kv k="network" v={RUN.network} />
            <Kv k="payTo" v={RUN.payTo} wraps />
            <Kv k="amount" v={RUN.amount} />
            <Kv k="signer" v={RUN.agentKey} wraps />
            <Kv k="nonce" v={RUN.nonce} />
            <Kv k="sig" v={RUN.signature} wraps />
            <div className="lv-desk-settled" data-settled>
              <span className="lv-desk-okmark">✓</span> payment settled · receipt{" "}
              {short(RUN.receiptHash)}
            </div>
          </section>

          <section className="lv-desk-fb" data-fb="verify">
            <div className="lv-desk-fblabel" data-typed>
              verify <span className="dim">· merkle path · 3 nodes</span>
            </div>
            <div className="lv-desk-tick" data-tick>
              leaf&nbsp;&nbsp;&nbsp;{short(RUN.reportHash)} · report hash
            </div>
            <div className="lv-desk-tick" data-tick>
              node 1&nbsp;H(leaf ‖ {short(RUN.siblings[0])}) ={" "}
              {short(RUN.pathNodes[0])}
            </div>
            <div className="lv-desk-tick" data-tick>
              node 2&nbsp;H({short(RUN.pathNodes[0])} ‖ {short(RUN.siblings[1])})
              = {short(RUN.pathNodes[1])}
            </div>
            <div className="lv-desk-tick" data-tick>
              node 3&nbsp;H({short(RUN.pathNodes[1])} ‖ {short(RUN.siblings[2])})
              = {short(RUN.datasetRoot)}
            </div>
            <div className="lv-desk-rootmatch wraps" data-rootmatch>
              <span className="lv-desk-okmark">✓ root match</span>{" "}
              <span className="lv-desk-roothash">{RUN.datasetRoot}</span>
            </div>
          </section>

          <section className="lv-desk-fb" data-fb="receipt">
            <div className="lv-desk-fblabel" data-typed>
              AgentPayRegistry <span className="dim">· {RUN.network}</span>
            </div>
            <Kv tick k="decision" v="approve" />
            <Kv tick k="report" v={RUN.reportHash} wraps />
            <Kv tick k="receipt" v={RUN.receiptHash} wraps />
            <Kv tick k="deploy" v={RUN.deployHash} wraps />
            <Kv tick k="block" v={RUN.blockHeight} />
          </section>
        </div>
      </div>
      <div className="lv-desk-feedsrc" aria-hidden="true">
        rpc.testnet.casperlabs.io · cspr.trade/api/observations
      </div>
      <span className="lv-desk-feedring" aria-hidden="true" />
    </div>
  );
}
