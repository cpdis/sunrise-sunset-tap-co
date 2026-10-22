"use client";

import { useState } from "react";
import { Loading, useData } from "@/components/ui";
import { cashAt } from "@/lib/domain";
import { useApp } from "@/lib/store";
import { money } from "@/lib/util";

export default function Owners() {
  const data = useData();
  const transfer = useApp((s) => s.transferShares);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [n, setN] = useState("1");
  if (!data) return <Loading />;
  const total = data.owners.reduce((s, o) => s + o.shares, 0);
  const capital = data.ledger.filter((e) => e.account === "capital").reduce((s, e) => s + e.amount, 0);
  const cash = cashAt(data);
  const truckBook = 27000; // carried at cost in the demo
  const nav = cash + truckBook;

  const stats = (id: string) => {
    const name = data.owners.find((o) => o.id === id)?.name ?? "";
    const div = -data.ledger.filter((e) => e.account === "dividends" && e.memo.endsWith(name)).reduce((s, e) => s + e.amount, 0);
    const runs = data.bookings.reduce((s, b) => s + (b.state === "completed" && b.kind === "paid" ? (b.deliver.ownerId === id ? 1 : 0) + (b.collect.ownerId === id ? 1 : 0) : 0), 0);
    const own = data.bookings.filter((b) => b.kind === "personal" && b.ownerId === id && b.state !== "cancelled").length;
    return { div, runs, own };
  };

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="admin-top"><h1>Owners</h1></div>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>Owner</th><th>Role</th><th className="num">Shares</th><th className="num">Stake</th><th className="num">Capital in</th><th className="num">Dividends</th><th className="num">Runs done</th><th className="num">Own-use days</th><th>Payout account</th></tr></thead>
          <tbody>
            {data.owners.map((o) => {
              const st = stats(o.id);
              return (
                <tr key={o.id}>
                  <td><strong>{o.name}</strong><br /><span className="muted">{o.email}</span></td>
                  <td>{o.isDirector ? "Director" : "Shareholder"}</td>
                  <td className="num">{o.shares}</td>
                  <td className="num">{Math.round((o.shares / total) * 1000) / 10}%</td>
                  <td className="num">{money(capital / data.owners.length)}</td>
                  <td className="num">{money(st.div)}</td>
                  <td className="num">{st.runs}</td>
                  <td className="num">{st.own}</td>
                  <td className="mono muted" style={{ fontSize: 12 }}>{o.payoutAccount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <div className="card stack" style={{ gap: 10 }}>
          <strong>What a share is worth (rough)</strong>
          <div className="summary-row"><span>Cash</span><span>{money(cash)}</span></div>
          <div className="summary-row"><span>Truck (at cost)</span><span>{money(truckBook)}</span></div>
          <div className="summary-row"><strong>Net assets</strong><strong>{money(nav)}</strong></div>
          <div className="summary-row"><strong>Per share</strong><strong>{money(nav / total)}</strong></div>
          <span className="muted" style={{ fontSize: 13 }}>An exiting owner offers their shares to the others pro rata first, at a price set by the shareholders agreement (usually net assets with an independent truck valuation).</span>
        </div>
        <form className="card stack" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); if (from && to && from !== to) transfer(from, to, Number(n)); }}>
          <strong>Record a share transfer</strong>
          <div className="grid cols-3">
            <div className="field"><label>From</label><select className="input" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">—</option>{data.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
            <div className="field"><label>To</label><select className="input" value={to} onChange={(e) => setTo(e.target.value)}><option value="">—</option>{data.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
            <div className="field"><label>Shares</label><input className="input" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} /></div>
          </div>
          <button className="btn small" style={{ alignSelf: "flex-start" }} disabled={!from || !to || from === to}>Record transfer</button>
          <span className="muted" style={{ fontSize: 13 }}>Future payouts split on the new holdings. ASIC needs a Form 484 within 28 days.</span>
        </form>
      </div>
    </div>
  );
}
