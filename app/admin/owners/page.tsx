"use client";

import { useState } from "react";
import { Loading, Section, useData } from "@/components/ui";
import { balance, cashAt, taxPayable, truckBookValue } from "@/lib/domain";
import { useApp } from "@/lib/store";
import { money } from "@/lib/util";

export default function Owners() {
  const data = useData();
  const transfer = useApp((s) => s.transferShares);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [n, setN] = useState("1");
  const [transferring, setTransferring] = useState(false);
  if (!data) return <Loading />;
  const total = data.owners.reduce((s, o) => s + o.shares, 0);
  const cash = cashAt(data);
  const truckBook = truckBookValue(data);
  const held = balance(data, "deposits");
  const owed = balance(data, "owed_runners");
  const tax = taxPayable(data);
  const nav = cash + truckBook - held - owed - tax;

  const stats = (id: string) => {
    const capital = balance(data, "capital", undefined, id);
    const div = -balance(data, "dividends", undefined, id);
    const fees = balance(data, "owed_runners", undefined, id);
    const runs = data.bookings.reduce((s, b) => s + (b.state === "completed" && b.kind === "paid" ? (b.deliver.ownerId === id ? 1 : 0) + (b.collect.ownerId === id ? 1 : 0) : 0), 0);
    const own = data.bookings.filter((b) => b.kind === "personal" && b.ownerId === id && b.state !== "cancelled").length;
    return { capital, div, runs, own, fees };
  };

  return (
    <div className="page">
      <div className="admin-top"><h1>Owners</h1></div>
      <Section title="Shareholders" aside={!transferring && <button className="btn small" onClick={() => setTransferring(true)}>Record transfer</button>}>
        {transferring && (
          <form className="card stack drawer" onSubmit={(e) => { e.preventDefault(); if (from && to && from !== to) { transfer(from, to, Number(n)); setTransferring(false); } }}>
            <div className="grid cols-3">
              <div className="field"><label htmlFor="tr-1">From</label><select id="tr-1" className="input" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">—</option>{data.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
              <div className="field"><label htmlFor="tr-2">To</label><select id="tr-2" className="input" value={to} onChange={(e) => setTo(e.target.value)}><option value="">—</option>{data.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
              <div className="field"><label htmlFor="tr-3">Shares</label><input id="tr-3" className="input" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} /></div>
            </div>
            <div className="row">
              <button className="btn small primary" disabled={!from || !to || from === to}>Record transfer</button>
              <button type="button" className="btn small" onClick={() => setTransferring(false)}>Cancel</button>
              <span className="note">A second director approves it before it counts. Future payouts then split on the new holdings. ASIC needs a Form 484 within 28 days.</span>
            </div>
          </form>
        )}
        <div className="table-wrap">
          <table className="t cards">
            <thead><tr><th>Owner</th><th className="hide-md">Role</th><th className="num hide-md">Shares</th><th className="num">Stake</th><th className="num">Capital in</th><th className="num">Dividends</th><th className="num hide-md">Runs done</th><th className="num">Fees owed</th><th className="num hide-md">Own-use days</th></tr></thead>
            <tbody>
              {data.owners.map((o) => {
                const st = stats(o.id);
                return (
                  <tr key={o.id}>
                    <td><strong>{o.name}</strong><span className="hide-sm"><br /><span className="muted">{o.email}</span><br /><span className="meta">{o.payoutAccount}</span></span></td>
                    <td className="hide-md" data-label="Role">{o.isDirector ? "Director" : "Shareholder"}</td>
                    <td className="num hide-md" data-label="Shares">{o.shares}</td>
                    <td className="num" data-label="Stake">{Math.round((o.shares / total) * 1000) / 10}%</td>
                    <td className="num" data-label="Capital in">{money(st.capital)}</td>
                    <td className="num" data-label="Dividends">{money(st.div)}</td>
                    <td className="num hide-md" data-label="Runs done">{st.runs}</td>
                    <td className="num" data-label="Fees owed">{money(st.fees)}</td>
                    <td className="num hide-md" data-label="Own-use days">{st.own}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <Section title="What a share is worth (rough)">
          <div className="card stack" style={{ gap: 12 }}>
            <div>
              <div className="summary-row"><span>Cash</span><span>{money(cash)}</span></div>
              <div className="summary-row"><span>Truck (cost less depreciation)</span><span>{money(truckBook)}</span></div>
              <div className="summary-row"><span>Customer money for hires ahead</span><span>−{money(held)}</span></div>
              <div className="summary-row"><span>Runner fees owed</span><span>−{money(owed)}</span></div>
              <div className="summary-row"><span>Company tax not yet paid</span><span>−{money(tax)}</span></div>
              <div className="summary-row total"><strong>Net assets</strong><strong>{money(nav)}</strong></div>
              <div className="summary-row"><strong>Per share</strong><strong>{money(nav / total)}</strong></div>
            </div>
            <span className="note">An exiting owner offers their shares to the others pro rata first, at a price set by the shareholders agreement (usually net assets with an independent truck valuation).</span>
          </div>
        </Section>
      </div>
    </div>
  );
}
