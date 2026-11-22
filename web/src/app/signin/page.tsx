"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "@/components/Brand";
import { useDemo } from "@/lib/store";
import { useToast } from "@/components/Toast";
import { DEMO_WALLET, fmt } from "@/lib/mock";
import { FAUCET_USDC_TARGET } from "@/lib/faucet";

/**
 * One flow for sign-in and sign-up, as the design hand-off specifies: the user
 * does not choose. We look for a wallet linked to the login; if there is none,
 * we make one.
 *
 * Privy owns the verification modal and creates an embedded Solana wallet for
 * a new email. The surrounding screen stays the approved design.
 */
type Step = "start" | "code" | "checking" | "created" | "name" | "welcome";

function Check({ children, delay }: { children: React.ReactNode; delay: number }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOn(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return (
    <div className={`check${on ? " on" : ""}`}>
      <i>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#2EBD85"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </i>
      <span style={{ fontSize: 14 }}>{children}</span>
    </div>
  );
}

export default function SignInPage() {
  const router = useRouter();
  const { signIn, signedIn, ready } = useDemo();
  const toast = useToast();

  const [step, setStep] = useState<Step>("start");
  const [demo, setDemo] = useState<"new" | "old">("new");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");

  useEffect(() => {
    if (ready && signedIn) router.replace("/app/trade");
  }, [ready, signedIn, router]);

  // "Looking for a wallet linked to this login."
  useEffect(() => {
    if (step !== "checking") return;
    const t = setTimeout(() => setStep(demo === "old" ? "welcome" : "created"), 1300);
    return () => clearTimeout(t);
  }, [step, demo]);

  useEffect(() => {
    if (step !== "welcome") return;
    const t = setTimeout(() => finish("tolu", false), 1400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function finish(name: string, isNew: boolean): void {
    signIn(name);
    toast(
      isNew
        ? `Wallet funded with ${fmt(FAUCET_USDC_TARGET)} tUSDC. You're on the naira market.`
        : `Welcome back, @${name}`,
    );
    router.push("/app/trade");
  }

  return (
    <main id="main" className="auth">
      <div className="auth-art">
        <div
          style={{
            position: "absolute",
            left: "15%",
            right: "15%",
            top: "25%",
            bottom: "25%",
            background:
              "radial-gradient(50% 50% at 50% 50%,rgba(61,92,245,.22),rgba(61,92,245,0) 70%)",
          }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/media/parallel-logo-glass.png" alt="" />
        <Brand href="/" style={{ position: "absolute", left: 36, top: 32 }} />
        <div style={{ position: "absolute", left: 36, right: 36, bottom: 36 }}>
          <div style={{ fontSize: 40, fontWeight: 500, letterSpacing: "-.04em", lineHeight: 1.05 }}>
            Two prices.
            <br />
            Trade the real one.
          </div>
          <div style={{ fontSize: 15, color: "var(--ink2)", marginTop: 10 }}>
            Naira, peso, rupee and more. On Solana.
          </div>
        </div>
      </div>

      <div className="auth-side">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div className="seg" role="group" aria-label="Demo account type">
            <button type="button" className={demo === "new" ? "on" : ""} onClick={() => setDemo("new")}>
              Demo: new user
            </button>
            <button type="button" className={demo === "old" ? "on" : ""} onClick={() => setDemo("old")}>
              Returning user
            </button>
          </div>
          <Link href="/" style={{ fontSize: 14, color: "var(--ink2)" }}>
            Back to site
          </Link>
        </div>

        <div className="auth-card">
          {step === "start" && (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <h1>Sign in or sign up</h1>
                <p>
                  One button for both. New here? We create your account and wallet. Been here
                  before? We open your existing wallet.
                </p>
              </div>
              <button className="gbtn" type="button" onClick={() => signIn()} style={{ display: "none" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 22c2.7 0 4.9-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"
                    fill="#34A853"
                  />
                  <path d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14z" fill="#FBBC05" />
                  <path
                    d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.4L6.4 10c.8-2.3 3-4.1 5.6-4.1z"
                    fill="#EA4335"
                  />
                </svg>
                Continue with Google
              </button>
              <div className="or">or</div>
              <form
                style={{ display: "flex", flexDirection: "column", gap: 12 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  signIn(email);
                }}
              >
                <label htmlFor="em">Email</label>
                <input
                  className="inp"
                  id="em"
                  type="email"
                  placeholder="you@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button className="btn btn-pri" style={{ height: 52 }} type="submit">
                  Continue with email
                </button>
              </form>
              <div className="note">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#7B93FF"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
                </svg>
                <span>
                  Your Solana wallet is linked to your Google or email. No seed phrase, no
                  extension, no fees.
                </span>
              </div>
            </>
          )}

          {step === "code" && (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <h1>Check your email</h1>
                <p>We sent a 6-digit code to {email || "you@example.com"}.</p>
              </div>
              <form
                style={{ display: "flex", flexDirection: "column", gap: 12 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  setStep("checking");
                }}
              >
                <label htmlFor="cd">Code</label>
                <input
                  className="inp mono"
                  id="cd"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  style={{ height: 64, fontSize: 28, letterSpacing: ".5em" }}
                />
                <button className="btn btn-pri" style={{ height: 52 }} type="submit">
                  Verify
                </button>
              </form>
              <button
                type="button"
                onClick={() => setStep("start")}
                style={{ border: "none", background: "none", color: "var(--ink2)", fontSize: 14, padding: 10 }}
              >
                Use a different email
              </button>
            </>
          )}

          {step === "checking" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, textAlign: "center" }}>
              <div className="spin" />
              <h1 style={{ fontSize: 28 }}>Checking your account…</h1>
              <p>Looking for a wallet linked to this login.</p>
            </div>
          )}

          {step === "created" && (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <h1>New account, all set</h1>
                <p>No wallet was linked to this login, so we made one. You paid nothing.</p>
              </div>
              <Check delay={250}>Solana wallet created — no seed phrase to keep</Check>
              <Check delay={600}>Funded with {fmt(FAUCET_USDC_TARGET)} test dollars</Check>
              <Check delay={950}>Network fees covered by Parallel</Check>
              <button
                className="btn btn-pri"
                style={{ height: 52 }}
                type="button"
                onClick={() => setStep("name")}
              >
                Pick a username
              </button>
            </>
          )}

          {step === "name" && (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <h1>Pick your username</h1>
                <p>Friends can send to it instead of a long wallet address.</p>
              </div>
              <form
                style={{ display: "flex", flexDirection: "column", gap: 12 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  finish(username || "trader", true);
                }}
              >
                <label htmlFor="un">Username</label>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    height: 56,
                    padding: "0 16px",
                    borderRadius: 14,
                    border: "1px solid var(--ln2)",
                    background: "var(--s1)",
                  }}
                >
                  <input
                    id="un"
                    value={username}
                    onChange={(e) =>
                      setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20))
                    }
                    placeholder="tolu"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      border: "none",
                      background: "none",
                      color: "var(--ink)",
                      font: "400 17px var(--font-geist), Geist, sans-serif",
                      outline: "none",
                    }}
                  />
                  <span className="mono" style={{ color: "var(--ink3)" }}>
                    .parallel
                  </span>
                </div>
                <span style={{ fontSize: 13, color: "var(--ink3)" }}>
                  {username ? `${username}.parallel is available` : "Pick at least one character"}
                </span>
                <button className="btn btn-pri" style={{ height: 52 }} type="submit">
                  Finish
                </button>
              </form>
            </>
          )}

          {step === "welcome" && (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <h1>Welcome back, @tolu</h1>
                <p>We found the wallet linked to this login and opened it. Nothing new was created.</p>
              </div>
              <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>
                  <span style={{ display: "block", fontSize: 13, color: "var(--ink3)" }}>Wallet</span>
                  <span className="mono">{DEMO_WALLET}</span>
                </span>
                <span style={{ textAlign: "right" }}>
                  <span style={{ display: "block", fontSize: 13, color: "var(--ink3)" }}>Balance</span>
                  <span className="mono">{fmt(FAUCET_USDC_TARGET)} tUSDC</span>
                </span>
              </div>
            </>
          )}
        </div>

        <p style={{ margin: 0, fontSize: 12, color: "var(--ink3)", lineHeight: 1.6, textAlign: "center" }}>
          By continuing you agree to the Terms and Risk disclosure. Devnet beta: balances are
          test tokens with no cash value.
        </p>
      </div>
    </main>
  );
}
