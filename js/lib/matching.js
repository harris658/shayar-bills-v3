(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};

  const DAY = 86400000;
  const daysApart = (a, b) =>
    Math.abs((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / DAY);

  function proposeMatches(txns, pendingBills) {
    const confident = [], suggested = [];
    const usedBill = new Set(), usedTxn = new Set();

    txns.forEach((t, ti) => {
      let best = -1, bestDist = Infinity;
      pendingBills.forEach((b, bi) => {
        if (usedBill.has(bi)) return;
        if (Number(b.amount) !== Number(t.amount)) return;
        const d = daysApart(t.txn_date, b.bill_date);
        if (d <= 5 && d < bestDist) { best = bi; bestDist = d; }
      });
      if (best >= 0) {
        confident.push({ txn: t, bill: pendingBills[best] });
        usedBill.add(best); usedTxn.add(ti);
      }
    });

    txns.forEach((t, ti) => {
      if (usedTxn.has(ti)) return;
      const bi = pendingBills.findIndex((b, i) =>
        !usedBill.has(i) && Number(b.amount) === Number(t.amount));
      if (bi >= 0) {
        suggested.push({ txn: t, bill: pendingBills[bi] });
        usedBill.add(bi); usedTxn.add(ti);
      }
    });

    return {
      confident, suggested,
      unmatchedTxns: txns.filter((_, i) => !usedTxn.has(i)),
      unmatchedBills: pendingBills.filter((_, i) => !usedBill.has(i))
    };
  }

  STB.matching = { proposeMatches };
})();
