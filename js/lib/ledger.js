(function () {
  'use strict';
  globalThis.STB = globalThis.STB || {};

  function totals(bills, monthPrefix) {
    let toPay = 0, toReceive = 0, monthPaid = 0, monthReceived = 0;
    for (const b of bills) {
      const amt = Number(b.amount);
      if (b.status === 'pending') {
        if (b.type === 'paid') toPay += amt; else toReceive += amt;
      }
      if (monthPrefix && String(b.bill_date).startsWith(monthPrefix)) {
        if (b.type === 'paid') monthPaid += amt; else monthReceived += amt;
      }
    }
    return { toPay, toReceive, monthPaid, monthReceived };
  }

  function outstandingByParty(bills) {
    const map = new Map();
    for (const b of bills) {
      if (b.status !== 'pending') continue;
      const e = map.get(b.party_id) || { party_id: b.party_id, toPay: 0, toReceive: 0 };
      if (b.type === 'paid') e.toPay += Number(b.amount); else e.toReceive += Number(b.amount);
      map.set(b.party_id, e);
    }
    return Array.from(map.values()).sort((a, b) => b.toPay - a.toPay);
  }

  function buildLedger(bills) {
    const sorted = bills.slice().sort((a, b) =>
      String(a.bill_date).localeCompare(String(b.bill_date)) ||
      String(a.created_at).localeCompare(String(b.created_at)));
    let running = 0;
    return sorted.map((bill) => {
      const delta = (bill.type === 'received' ? 1 : -1) * Number(bill.amount);
      running += delta;
      return { bill, delta, running };
    });
  }

  STB.ledger = { totals, outstandingByParty, buildLedger };
})();
